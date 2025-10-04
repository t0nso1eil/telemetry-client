const F1TelemetryClient = require('./telemetry.client');

async function main() {
    const client = new F1TelemetryClient();

    // общий апдейт
    client.on('update', ({ state }) => {
        console.log("🏎️ Current lap:", state.lapCount?.CurrentLap || "N/A");
    });

    // конкретный поток
    client.on('TimingData', (data) => {
        if (data.Lines) {
            Object.values(data.Lines).forEach((driver) => {
                if (driver?.Position === 1) {
                    console.log("🥇 Leader:", driver.DriverId, driver.KPH, "kph");
                }
            });
        }
    });

    client.on('WeatherData', (weather) => {
        console.log("🌦️ Weather:", weather?.AirTemp, "°C, Rain?", weather?.Raining);
    });

    client.on('RaceControlMessages', (msg) => {
        console.log("📢 Race Control:", msg.Message);
    });

    await client.start(["Heartbeat", "DriverList", "TimingData", "SessionInfo","SessionStatus","TeamRadio", "WeatherData", "RaceControlMessages","TimingAppData","TimingStats","TrackStatus",
                       "Position.z","CarData.z", "SessionData", "TopThree", "LapCount"]);
}

main();

