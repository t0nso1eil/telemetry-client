class F1DataFilter {
    static filterByDriver(data, driverNumber) {
        // Фильтрация данных по номеру пилота
        if (data.TimingData && data.TimingData.Lines) {
            return Object.values(data.TimingData.Lines).find(
                line => line.RacingNumber === driverNumber.toString()
            );
        }
        return null;
    }

    static extractLapTimes(timingData) {
        // Извлечение времени кругов
        const lapTimes = {};
        if (timingData && timingData.Lines) {
            Object.entries(timingData.Lines).forEach(([key, driver]) => {
                if (driver.LapTimes && driver.LapTimes.length > 0) {
                    lapTimes[driver.RacingNumber] = driver.LapTimes;
                }
            });
        }
        return lapTimes;
    }

    static getSessionStatus(sessionInfo) {
        // Статус сессии
        return {
            status: sessionInfo.Status,
            type: sessionInfo.Type,
            meeting: sessionInfo.Meeting?.Name,
            session: sessionInfo.Name
        };
    }
}

module.exports = F1DataFilter;