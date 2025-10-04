const axios = require('axios');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

class F1TelemetryRawClient {
    constructor() {
        this.socket = null;
        this.isConnected = false;
        this.connectionToken = null;
        this.cookie = null;
        this.messageCount = 0;
        this.lastSaveTime = Date.now();
        this.saveInterval = 2000; // 2 секунды
        this.buffer = [];

        // Файлы для данных
        this.rawDataFile = path.join(__dirname, 'f1_raw_data.json');
        this.liveDataFile = path.join(__dirname, 'f1_live_data.json');

        this.initializeDataFiles();
    }

    // Инициализация файлов данных
    initializeDataFiles() {
        const initialData = {
            startTime: new Date().toISOString(),
            messages: [],
            lastUpdate: null
        };

        fs.writeFileSync(this.rawDataFile, JSON.stringify(initialData, null, 2));
        fs.writeFileSync(this.liveDataFile, JSON.stringify({ current: null }, null, 2));
        console.log(`📁 Data files initialized`);
    }

    // Сохранение данных в файл
    saveDataToFile() {
        if (this.buffer.length === 0) return;

        try {
            // Читаем текущие данные
            const rawData = JSON.parse(fs.readFileSync(this.rawDataFile, 'utf8'));

            // Добавляем новые сообщения
            rawData.messages.push(...this.buffer);
            rawData.lastUpdate = new Date().toISOString();
            rawData.totalMessages = this.messageCount;

            // Сохраняем
            fs.writeFileSync(this.rawDataFile, JSON.stringify(rawData, null, 2));

            // Сохраняем последнее сообщение в live файл
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

    // Переговоры о подключении
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

    // Подключение через WebSocket
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
                    console.log('✅ WebSocket connection established');
                    this.isConnected = true;

                    // Запускаем автосохранение каждые 2 секунды
                    this.startAutoSave();
                    resolve(true);
                });

                this.socket.on('message', (data) => {
                    this.handleRawMessage(data);
                });

                this.socket.on('error', (error) => {
                    console.error('WebSocket error:', error);
                    reject(error);
                });

                this.socket.on('close', (code, reason) => {
                    console.log(`🔌 Connection closed: ${code} - ${reason}`);
                    this.isConnected = false;
                    this.stopAutoSave();

                    // Автопереподключение
                    setTimeout(() => {
                        console.log('🔄 Reconnecting...');
                        this.reconnect();
                    }, 5000);
                });

                setTimeout(() => {
                    if (!this.isConnected) {
                        reject(new Error('Connection timeout'));
                    }
                }, 10000);
            });

        } catch (error) {
            console.error('❌ Connection failed:', error);
            return false;
        }
    }

    // Обработка сырых сообщений
    handleRawMessage(data) {
        try {
            const message = data.toString();
            this.messageCount++;

            // Пропускаем полностью пустые сообщения
            if (!message || message === '{}') {
                return;
            }

            // Парсим JSON чтобы убедиться в валидности
            const parsedMessage = JSON.parse(message);

            // Сохраняем в буфер
            this.buffer.push({
                timestamp: new Date().toISOString(),
                messageId: this.messageCount,
                data: parsedMessage
            });

            // Периодический лог
            if (this.messageCount % 50 === 0) {
                console.log(`📨 Received ${this.messageCount} messages`);
            }

        } catch (error) {
            console.error('Error processing message:', error);

            // Сохраняем даже невалидные сообщения как текст
            this.buffer.push({
                timestamp: new Date().toISOString(),
                messageId: this.messageCount,
                error: error.message,
                raw: data.toString()
            });
        }
    }

    // Автосохранение каждые 2 секунды
    startAutoSave() {
        this.autoSaveInterval = setInterval(() => {
            this.saveDataToFile();
        }, this.saveInterval);
    }

    stopAutoSave() {
        if (this.autoSaveInterval) {
            clearInterval(this.autoSaveInterval);
            this.autoSaveInterval = null;
        }
    }

    // Переподключение
    async reconnect() {
        try {
            await this.negotiate();
            await this.connect();

            setTimeout(() => {
                if (this.isConnected) {
                    this.subscribe(this.currentStreams);
                }
            }, 1000);

        } catch (error) {
            console.error('Reconnection failed:', error);
        }
    }

    // Подписка на все потоки
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

    // Запуск клиента
    async start(streams) {
        console.log('🚀 Starting F1 Raw Telemetry Client...');

        const negotiated = await this.negotiate();
        if (!negotiated) return;

        const connected = await this.connect();
        if (!connected) return;

        // Подписка после подключения
        setTimeout(() => {
            this.subscribe(streams);
            console.log('🎯 Listening for raw telemetry data...');
        }, 2000);
    }

    // Остановка клиента
    stop() {
        this.stopAutoSave();
        // Сохраняем оставшиеся данные перед выходом
        this.saveDataToFile();

        if (this.socket) {
            this.socket.close();
        }
        this.isConnected = false;
        console.log(`🛑 Client stopped. Total messages: ${this.messageCount}`);
    }
}

// Все доступные потоки данных
const ALL_STREAMS = [
    "Heartbeat", "AudioStreams", "DriverList",
    "ExtrapolatedClock", "RaceControlMessages",
    "SessionInfo", "SessionStatus", "TeamRadio",
    "TimingAppData", "TimingStats", "TrackStatus",
    "WeatherData", "Position.z", "CarData.z",
    "ContentStreams", "SessionData", "TimingData",
    "TopThree", "RcmSeries", "LapCount"
];

// Запуск
async function main() {
    const client = new F1TelemetryRawClient();

    await client.start(ALL_STREAMS);

    // Обработка завершения
    process.on('SIGINT', () => {
        console.log('\n🛑 Shutting down...');
        client.stop();
        process.exit(0);
    });

    process.on('SIGTERM', () => {
        console.log('\n🔚 Terminating...');
        client.stop();
        process.exit(0);
    });
}

// Запуск приложения
if (require.main === module) {
    main().catch(console.error);
}

module.exports = F1TelemetryRawClient;