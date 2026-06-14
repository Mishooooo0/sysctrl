const { app, BrowserWindow, ipcMain, desktopCapturer, screen } = require('electron');
const path = require('path');
const axios = require('axios');
const find = require('local-devices');
const { mouse, keyboard, Key, Button, Point, straightTo } = require('@nut-tree-fork/nut-js');

let mainWindow;
let isRunning = false;
let hostUrl = null;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 800,
        height: 700,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });

    mainWindow.loadFile('index.html');
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

// Discovery Logic
async function discoverHost() {
    log('Scanning local network for sysctrl-host...', 'agent');
    updateStatus('Scanning...');

    while (!hostUrl && isRunning) {
        try {
            const devices = await find();
            for (const device of devices) {
                try {
                    // Try to ping Ollama port on each found device
                    const response = await axios.get(`http://${device.ip}:11434/api/tags`, { timeout: 1000 });
                    if (response.status === 200) {
                        hostUrl = `http://${device.ip}:11434`;
                        log(`Found host at ${hostUrl}`, 'agent');
                        return hostUrl;
                    }
                } catch (e) {
                    // Not the host
                }
            }
            log('Host not found, retrying in 5s...', 'agent');
            await new Promise(r => setTimeout(r, 5000));
        } catch (error) {
            log(`Scan error: ${error.message}`, 'error');
            await new Promise(r => setTimeout(r, 5000));
        }
    }
    return hostUrl;
}

// IPC Handlers
ipcMain.on('start-agent', async (event, config) => {
    isRunning = true;
    log('Starting discovery...', 'agent');

    // If user provided a URL, try that first, otherwise discover
    if (config.ollamaUrl && config.ollamaUrl !== 'http://localhost:11434') {
        hostUrl = config.ollamaUrl;
    } else {
        hostUrl = await discoverHost();
    }

    if (hostUrl && isRunning) {
        config.ollamaUrl = hostUrl;
        runLoop(config);
    }
});

ipcMain.on('stop-agent', () => {
    isRunning = false;
    hostUrl = null;
    log('Agent stopping...', 'agent');
});

function log(message, type = 'agent') {
    if (mainWindow) {
        mainWindow.webContents.send('log', message, type);
    }
    console.log(`[${type}] ${message}`);
}

function updateStatus(status) {
    if (mainWindow) {
        mainWindow.webContents.send('status', status);
    }
}

async function takeScreenshot() {
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.size;

    const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width, height }
    });

    if (sources.length > 0) {
        return sources[0].thumbnail.toDataURL().split(',')[1]; // Base64
    }
    throw new Error('Could not capture screen');
}

async function runLoop(config) {
    const { ollamaUrl, modelName, taskDesc } = config;

    const systemPrompt = `You are sysctrl, an AI agent that controls a laptop.
Your goal is: ${taskDesc}

You will receive a screenshot of the current screen.
Analyze the screen and decide on the next logical action.
Respond ONLY with a JSON object in the following format:
{
  "thought": "description of what you see and why you take this action",
  "action": "move_click" | "type" | "press" | "scroll" | "wait" | "done",
  "params": {
    "x": number (0-100 percentage of screen width),
    "y": number (0-100 percentage of screen height),
    "text": "string for typing",
    "key": "string for key press (e.g., 'Enter', 'Esc')",
    "direction": "up" | "down",
    "duration": number (ms for wait)
  }
}

Important:
- Coordinates x and y are percentages (0-100).
- If you are finished, set action to "done".
- Be precise. If you need to click a button, move and click at its center.`;

    while (isRunning) {
        try {
            updateStatus('Observing...');
            const base64Image = await takeScreenshot();

            updateStatus('Reasoning...');
            log('Sending screenshot to Ollama...', 'agent');

            const response = await axios.post(`${ollamaUrl}/api/generate`, {
                model: modelName,
                prompt: "What is the next action?",
                images: [base64Image],
                system: systemPrompt,
                stream: false,
                format: "json"
            });

            const result = JSON.parse(response.data.response);
            log(`Thought: ${result.thought}`, 'agent');

            if (result.action === 'done') {
                log('Task completed!', 'agent');
                updateStatus('Finished');
                isRunning = false;
                break;
            }

            updateStatus('Acting...');
            await executeAction(result);

            // Wait a bit for the UI to update
            await new Promise(r => setTimeout(r, 1000));

        } catch (error) {
            log(`Error: ${error.message}`, 'error');
            updateStatus('Error');
            isRunning = false;
        }
    }
}

async function executeAction(result) {
    const { action, params } = result;
    const { width, height } = screen.getPrimaryDisplay().size;

    log(`Action: ${action} ${JSON.stringify(params)}`, 'action');

    switch (action) {
        case 'move_click':
            if (params.x !== undefined && params.y !== undefined) {
                const targetX = (params.x / 100) * width;
                const targetY = (params.y / 100) * height;
                await mouse.move(straightTo(new Point(targetX, targetY)));
                await mouse.click(Button.LEFT);
            }
            break;
        case 'type':
            if (params.text) {
                await keyboard.type(params.text);
            }
            break;
        case 'press':
            if (params.key) {
                try {
                    await keyboard.type(Key[params.key] || params.key);
                } catch(e) {
                    log(`Failed to press key: ${params.key}`, 'error');
                }
            }
            break;
        case 'scroll':
            if (params.direction === 'down') await mouse.scrollDown(500);
            else await mouse.scrollUp(500);
            break;
        case 'wait':
            await new Promise(r => setTimeout(r, params.duration || 1000));
            break;
    }
}