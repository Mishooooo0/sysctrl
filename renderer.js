const startBtn = document.getElementById('start');
const stopBtn = document.getElementById('stop');
const statusDiv = document.getElementById('status');
const logDiv = document.getElementById('log');

const ollamaUrlInput = document.getElementById('ollama-url');
const modelNameInput = document.getElementById('model-name');
const taskDescInput = document.getElementById('task-desc');

startBtn.addEventListener('click', () => {
    const config = {
        ollamaUrl: ollamaUrlInput.value,
        modelName: modelNameInput.value,
        taskDesc: taskDescInput.value
    };

    if (!config.taskDesc) {
        alert('Please enter a task description');
        return;
    }

    window.electronAPI.startAgent(config);
    startBtn.disabled = true;
    stopBtn.disabled = false;
    statusDiv.innerText = 'Status: Running';
});

stopBtn.addEventListener('click', () => {
    window.electronAPI.stopAgent();
    startBtn.disabled = false;
    stopBtn.disabled = true;
    statusDiv.innerText = 'Status: Stopping...';
});

window.electronAPI.onLog((message, type = 'agent') => {
    const entry = document.createElement('div');
    entry.className = `log-entry log-${type}`;
    entry.innerText = `[${new Date().toLocaleTimeString()}] ${message}`;
    logDiv.appendChild(entry);
    logDiv.scrollTop = logDiv.scrollHeight;
});

window.electronAPI.onStatus((status) => {
    statusDiv.innerText = `Status: ${status}`;
    if (status === 'Idle' || status === 'Stopped' || status === 'Finished') {
        startBtn.disabled = false;
        stopBtn.disabled = true;
    }
});