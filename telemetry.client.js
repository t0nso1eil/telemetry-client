const axios = require('axios');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

class F1TelemetryClient extends EventEmitter {
    constructor() {
        super();
        this.socket = null;
        this.isConnected = false;
        this.connectionToken = null;
        this.cookie = null;

        this.messageCount = 0;        // Локальный счётчик (для диагностики)
        this.lastMessageId = 0;       // Последний применённый messageId
        this.pending = new Map();     // Очередь для сообщений (по порядку)

        this.buffer = [];             // Для записи в файл
        this.saveInterval = 2000;

        this.state = {};              // Текущее состояние гонки

        this.rawDataFile = path.join(__dirname, 'f1_raw_data.json');
        this.liveDataFile = path.join(__dirname, 'f1_live_data.json');
        this.initializeDataFiles();
    }

    initializeDataFiles() {
        fs.writeFileSync(this.rawDataFile, JSON.stringify({ startTime: new Date().toISOString(), messages: [] }, null, 2));
        fs.writeFileSync(this.liveDataFile, JSON.stringify({ current: null }, null, 2));
        console.log(`📁 Data files initialized`);
    }

    saveDataToFile() {
        if (this.buffer.length === 0) return;
        try {
            const rawData = JSON.parse(fs.readFileSync(this.rawDataFile, 'utf8'));
            rawData.messages.push(...this.buffer);
            rawData.lastUpdate = new Date().toISOString();
            rawData.totalMessages = this.messageCount;

            fs.writeFileSync(this.rawDataFile, JSON.stringify(rawData, null, 2));

            const lastMessage = this.buffer[this.buffer.length - 1];
            fs.writeFileSync(this.liveDataFile, JSON.stringify({
                current: lastMessage,
                timestamp: new Date().toISOString(),
                messageCount: this.messageCount
            }, null, 2));

            console.log(`💾 Saved ${this.buffer.length} messages (Total: ${this.messageCount})`);
            this.buffer = [];
        } catch (error) {
            console.error('Error saving data:', error);
        }
    }

    async negotiate() {
        try {
            const hub = encodeURIComponent(JSON.stringify([{ name: "Streaming" }]));
            const url = `https://livetiming.formula1.com/signalr/negotiate?connectionData=${hub}&clientProtocol=1.5`;

            const response = await axios.get(url);
            this.connectionToken = response.data.ConnectionToken;
            this.cookie = Array.isArray(response.headers['set-cookie'])
                ? response.headers['set-cookie'].join('; ')
                : response.headers['set-cookie'];

            console.log('✅ Negotiation successful');
            return true;
        } catch (error) {
            console.error('❌ Negotiation failed:', error.message);
            return false;
        }
    }

    async connect() {
        if (!this.connectionToken || !this.cookie) {
            console.error('No connection token or cookie available.');
            return false;
        }

        try {
            const hub = encodeURIComponent(JSON.stringify([{ name: "Streaming" }]));
            const encodedToken = encodeURIComponent(this.connectionToken);
            const url = `wss://livetiming.formula1.com/signalr/connect?clientProtocol=1.5&transport=webSockets&connectionToken=${encodedToken}&connectionData=${hub}`;

            this.socket = new WebSocket(url, {
                headers: {
                    'User-Agent': 'BestHTTP',
                    'Accept-Encoding': 'gzip,identity',
                    'Cookie': this.cookie
                }
            });

            return new Promise((resolve, reject) => {
                this.socket.on('open', () => {
                    console.log('✅ WebSocket connected');
                    this.isConnected = true;
                    this.startAutoSave();
                    resolve(true);
                });

                this.socket.on('message', (data) => this.handleRawMessage(data));
                this.socket.on('error', (error) => {
                    this.emit('error', error);
                    reject(error);
                });
                this.socket.on('close', (code, reason) => {
                    console.log(`🔌 Closed: ${code} - ${reason}`);
                    this.isConnected = false;
                    this.stopAutoSave();
                    setTimeout(() => this.reconnect(), 5000);
                });

                setTimeout(() => {
                    if (!this.isConnected) reject(new Error('Connection timeout'));
                }, 10000);
            });
        } catch (error) {
            console.error('❌ Connection failed:', error);
            return false;
        }
    }

    handleRawMessage(data) {
        try {
            const parsed = JSON.parse(data.toString());
            this.messageCount++;

            const messageId = parsed.MessageId ?? this.messageCount;

            this.pending.set(messageId, { payload: parsed, timestamp: Date.now() });
            this.buffer.push({ messageId, data: parsed, timestamp: new Date().toISOString() });

            if (this.messageCount % 50 === 0) {
                console.log(`📨 Received ${this.messageCount} messages`);
            }

            this.tryProcessQueue();
            this.emit('raw', parsed);

        } catch (error) {
            this.emit('error', error);
            this.buffer.push({ error: error.message, raw: data.toString() });
        }
    }

    tryProcessQueue() {
        while (this.pending.has(this.lastMessageId + 1)) {
            const nextId = this.lastMessageId + 1;
            const msg = this.pending.get(nextId);
            this.pending.delete(nextId);

            this.applyUpdate(msg.payload);
            this.lastMessageId = nextId;
        }
    }

applyUpdate(message) {
    try {
        // Обычно в SignalR сообщения идут в массиве 'M'
        if (!message.M || !Array.isArray(message.M)) {
            return;
        }

        for (const m of message.M) {
            const hub = m.H;  // "Streaming"
            const method = m.M; // Название типа потока
            const data = m.A && m.A[0]; // payload

            if (!method) continue;

            switch (method) {
                case "Heartbeat":
                    this.state.heartbeat = {
                        ...data,
                        timestamp: new Date().toISOString()
                    };
                    break;

                case "SessionInfo":
                    this.state.sessionInfo = data;
                    break;

                case "TimingData":
                    // данные о пилотах, позициях, секторах и т.д.
                    this.state.timingData = {
                        ...this.state.timingData,
                        ...data
                    };
                    if (data.Lines) {
                        Object.entries(data.Lines).forEach(([driverId, driverInfo]) => {
                            this.state.drivers[driverId] = {
                                ...(this.state.drivers[driverId] || {}),
                                ...driverInfo
                            };
                        });
                    }
                    break;

                case "WeatherData":
                    this.state.weather = data;
                    break;

                case "TrackStatus":
                    this.state.trackStatus = data;
                    break;

                case "RaceControlMessages":
                    this.state.raceControl = this.state.raceControl || [];
                    this.state.raceControl.push({
                        ...data,
                        receivedAt: new Date().toISOString()
                    });
                    break;

                case "SessionStatus":
                    this.state.sessionStatus = data;
                    break;

                case "LapCount":
                    this.state.lapCount = data;
                    break;

                case "CarData.z":
                    this.state.carData = data;
                    break;

                default:
                    // можно логировать редкие / новые методы
                    // console.log("Unhandled stream:", method);
                    break;
            }

            // отдать наружу событие по конкретному типу
            this.emit(method, data);
        }

        // отдать событие "update" с целым state
        this.emit('update', { state: this.state, message });

    } catch (err) {
        this.emit('error', err);
    }
}


    startAutoSave() {
        this.autoSaveInterval = setInterval(() => this.saveDataToFile(), this.saveInterval);
    }
    stopAutoSave() {
        if (this.autoSaveInterval) clearInterval(this.autoSaveInterval);
    }

    async reconnect() {
        console.log('🔄 Reconnecting...');
        try {
            await this.negotiate();
            await this.connect();
            if (this.currentStreams) this.subscribe(this.currentStreams);
        } catch (error) {
            console.error('Reconnection failed:', error);
        }
    }

    subscribe(streams) {
        if (!this.isConnected || !this.socket) {
            console.error('Not connected to WebSocket');
            return false;
        }
        this.currentStreams = streams;
        const subscribeMessage = {
            "H": "Streaming",
            "M": "Subscribe",
            "A": [streams],
            "I": 1
        };
        this.socket.send(JSON.stringify(subscribeMessage));
        console.log(`✅ Subscribed to ${streams.length} streams`);
        return true;
    }

    async start(streams) {
        console.log('🚀 Starting client...');
        const negotiated = await this.negotiate();
        if (!negotiated) return;
        const connected = await this.connect();
        if (!connected) return;
        setTimeout(() => {
            this.subscribe(streams);
            console.log('🎯 Listening...');
        }, 2000);
    }

    stop() {
        this.stopAutoSave();
        this.saveDataToFile();
        if (this.socket) this.socket.close();
        this.isConnected = false;
        console.log(`🛑 Client stopped. Total messages: ${this.messageCount}`);
    }
}

module.exports = F1TelemetryClient;
