const F1TelemetryClient = require('./telemetry.client');

async function startApp() {
    console.log('🚦 Starting F1 Telemetry Client Test...');

    const client = new F1TelemetryClient();

    try {
        // Подписываемся на ВСЕ доступные потоки данных
        const allStreams = [
            "Heartbeat",
            "TimingData",
            "TimingAppData",
            "SessionInfo",
            "SessionData",
            "TrackData",
            "DriverList",
            "WeatherData",
            "RaceControlMessages",
            "TimingStats",
            "LapCount",
            "PitLaneTime",
            "TeamRadio",
            "CarData",
            "Position",
            "ExtrapolatedClock",
            "TopThree",
            "RcmSeries",
            "TimingPrerequisites",
            "GameState"
        ];

        await client.start(allStreams);

        console.log('\n📡 Listening for ALL F1 telemetry data streams...');
        console.log('✅ Subscribed to:', allStreams.length, 'different data streams');
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