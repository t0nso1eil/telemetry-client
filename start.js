const F1TelemetryClient = require('./telemetry.client');

async function startApp() {
    console.log('🚦 Starting F1 Telemetry Client Test...');

    const client = new F1TelemetryClient();

    try {
        // Подписываемся на минимальный набор потоков для теста
        await client.start(["Heartbeat", "TimingData", "SessionInfo"]);

        console.log('\n📡 Listening for F1 telemetry data...');
        console.log('Press Ctrl+C to stop\n');

    } catch (error) {
        console.error('❌ Failed to start:', error.message);
        process.exit(1);
    }

    // Обработка завершения
    process.on('SIGINT', () => {
        console.log('\n🛑 Shutting down F1 Telemetry Client...');
        client.stop();
        process.exit(0);
    });

    process.on('SIGTERM', () => {
        console.log('\n🔚 Terminating F1 Telemetry Client...');
        client.stop();
        process.exit(0);
    });
}

// Проверяем, запущен ли файл напрямую
if (require.main === module) {
    startApp();
}

module.exports = startApp;