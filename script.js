import * as pdfjsLib from 'https://mozilla.github.io/pdf.js/build/pdf.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://mozilla.github.io/pdf.js/build/pdf.worker.mjs';

let vocabList = []; // Mảng lưu từ vựng với correct và wrong
const STORAGE_KEY = 'vocabProgress'; // Key cho localStorage

const fileUpload = document.getElementById('fileUpload');
const loadBtn = document.getElementById('loadBtn');
const quizSection = document.getElementById('quizSection');
const questionDiv = document.getElementById('question');
const optionsDiv = document.getElementById('options');
const nextBtn = document.getElementById('nextBtn');
const skipBtn = document.getElementById('skipBtn');

loadBtn.addEventListener('click', loadFile);
nextBtn.addEventListener('click', generateQuestion);
skipBtn.addEventListener('click', generateQuestion); // Bỏ qua chỉ next mà không update

// Hàm đọc file .xlsx hoặc .pdf
function loadFile() {
    const file = fileUpload.files[0];
    if (!file) {
        alert('Vui lòng chọn file .xlsx hoặc .pdf');
        return;
    }

    const reader = new FileReader();
    reader.onload = async function(e) {
        const data = e.target.result;
        let newVocab = [];

        if (file.name.endsWith('.xlsx')) {
            // Xử lý XLSX
            const workbook = XLSX.read(new Uint8Array(data), { type: 'array' });
            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            const json = XLSX.utils.sheet_to_json(sheet, { header: 1 });
            newVocab = json.slice(1).map(row => ({
                chinese: row[0],
                pinyin: row[1],
                vietnamese: row[2],
                correct: 0,
                wrong: 0
            })).filter(row => row.chinese && row.vietnamese);
        } else if (file.name.endsWith('.pdf')) {
            // Xử lý PDF
            const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(data) });
            try {
                const pdf = await loadingTask.promise;
                const totalPages = pdf.numPages;
                let fullText = '';

                for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
                    const page = await pdf.getPage(pageNum);
                    const textContent = await page.getTextContent();
                    const pageText = textContent.items.map(item => item.str).join(' ');
                    fullText += pageText + '\n';
                }

                // Parse text từ PDF: Giả sử mỗi dòng là "chinese pinyin vietnamese" separated by space
                const lines = fullText.split('\n').filter(line => line.trim());
                newVocab = lines.map(line => {
                    const parts = line.trim().split(/\s+/);
                    if (parts.length >= 3) {
                        return {
                            chinese: parts[0],
                            pinyin: parts[1],
                            vietnamese: parts.slice(2).join(' '), // Join phần còn lại nếu nghĩa có space
                            correct: 0,
                            wrong: 0
                        };
                    }
                    return null;
                }).filter(row => row && row.chinese && row.vietnamese);
            } catch (error) {
                console.error('Lỗi khi đọc PDF:', error);
                alert('Không thể đọc file PDF. Vui lòng kiểm tra định dạng.');
                return;
            }
        } else {
            alert('File không hỗ trợ. Chỉ chấp nhận .xlsx hoặc .pdf.');
            return;
        }

        if (newVocab.length < 4) {
            alert('File cần ít nhất 4 từ vựng hợp lệ.');
            return;
        }

        // Load tiến độ từ localStorage và merge
        const savedProgress = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
        vocabList = newVocab.map(word => {
            const key = word.chinese; // Sử dụng từ Trung làm key unique
            return {
                ...word,
                correct: savedProgress[key]?.correct || 0,
                wrong: savedProgress[key]?.wrong || 0
            };
        });

        // Lọc bỏ từ đã đúng >=50 lần
        vocabList = vocabList.filter(word => word.correct < 50);

        if (vocabList.length < 4) {
            alert('Không đủ từ vựng để chơi (có thể nhiều từ đã học xong).');
            return;
        }

        // Hiển thị quiz
        quizSection.style.display = 'block';
        generateQuestion();
    };

    // Đọc file dưới dạng ArrayBuffer cho cả hai loại
    reader.readAsArrayBuffer(file);
}

// Tạo câu hỏi ngẫu nhiên (vô tận, không giới hạn)
function generateQuestion() {
    nextBtn.style.display = 'none';
    optionsDiv.innerHTML = ''; // Clear options
    Array.from(optionsDiv.children).forEach(child => child.disabled = false); // Enable buttons

    // Chọn từ weighted: Ưu tiên từ sai nhiều, đúng ít
    const weights = vocabList.map(word => word.wrong + 1 / (word.correct + 1));
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    let random = Math.random() * totalWeight;
    let selectedIndex = -1;
    for (let i = 0; i < weights.length; i++) {
        random -= weights[i];
        if (random <= 0) {
            selectedIndex = i;
            break;
        }
    }
    const question = vocabList[selectedIndex];

    // Ngẫu nhiên loại câu hỏi: 50% nghĩa, 50% pinyin (nếu có pinyin)
    const questionType = Math.random() < 0.5 ? 'vietnamese' : 'pinyin';
    let targetField = questionType;
    let optionsField = questionType;
    let prompt = questionType === 'vietnamese' ? 'Chọn nghĩa đúng:' : 'Chọn pinyin đúng:';

    if (!question.pinyin && questionType === 'pinyin') {
        // Nếu không có pinyin, fallback sang nghĩa
        targetField = 'vietnamese';
        prompt = 'Chọn nghĩa đúng:';
    }

    questionDiv.innerHTML = `<p>Từ: <span class="word">${question.chinese}</span></p><p>${prompt}</p>`;

    // Tạo options: 1 đúng + 3 sai ngẫu nhiên
    const options = [question[targetField]];
    while (options.length < 4) {
        const randomWrongIndex = Math.floor(Math.random() * vocabList.length);
        const randomWrong = vocabList[randomWrongIndex][targetField];
        if (randomWrong && !options.includes(randomWrong)) options.push(randomWrong);
    }
    shuffle(options);

    options.forEach(opt => {
        const btn = document.createElement('button');
        btn.textContent = opt;
        btn.onclick = () => checkAnswer(opt, question[targetField], btn, question, selectedIndex);
        optionsDiv.appendChild(btn);
    });
}

// Kiểm tra đáp án
function checkAnswer(selected, correct, btn, question, index) {
    if (selected === correct) {
        btn.classList.add('correct');
        vocabList[index].correct++;
        // Nếu đúng >=50, loại bỏ khỏi list
        if (vocabList[index].correct >= 50) {
            vocabList.splice(index, 1);
        }
    } else {
        btn.classList.add('incorrect');
        vocabList[index].wrong++;
        // Highlight đáp án đúng
        Array.from(optionsDiv.children).forEach(child => {
            if (child.textContent === correct) child.classList.add('correct');
        });
    }
    saveProgress();
    // Disable các button khác
    Array.from(optionsDiv.children).forEach(child => child.disabled = true);
    nextBtn.style.display = 'block'; // Hiển thị next sau khi trả lời
}

// Lưu tiến độ vào localStorage
function saveProgress() {
    const progress = {};
    vocabList.forEach(word => {
        const key = word.chinese;
        progress[key] = { correct: word.correct, wrong: word.wrong };
    });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
}

// Hàm xáo trộn mảng
function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
}
