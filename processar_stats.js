// processar_stats.js

const fetch = require('node-fetch');
const fs = require('fs');

// --- 1. FUNÇÕES DE AJUDA GLOBAIS ---
const translations_en_fake = {
    weekdays: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
    ago: { d: "{n}d", s: "now" }
};

function getSismoColor(magnitude) {
    if (typeof magnitude !== 'number' || magnitude === null || magnitude <= 0) return '#08e108';
    if (magnitude >= 9.0) return '#00ffff';
    if (magnitude >= 8.0) return '#da70d6';
    if (magnitude >= 7.0) return '#ff4500';
    if (magnitude >= 6.0) return '#ff0000';
    if (magnitude >= 5.0) return 'orange';
    if (magnitude >= 4.0) return 'yellow';
    if (magnitude >= 2.0) return '#08e108';
    return '#FFFFFF';
}

function formatEarthquakeDateTime(timestamp) {
    const date = new Date(timestamp);
    const day = date.getDate();
    const monthIndex = date.getMonth();
    const year = date.getFullYear();
    const optionsTime = { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short', hour12: false };
    const timeStr = new Intl.DateTimeFormat('en-US', optionsTime).format(date);
    return { formattedDate: `${day}/${monthIndex + 1}/${year}`, formattedTime: timeStr };
}

// --- 2. LÓGICA DE BUSCA DE DADOS ---
async function fetchCombinedQuakeData(startTime, endTime) {
    const USGS_URL = `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&starttime=${startTime.toISOString()}&endtime=${endTime.toISOString()}&minmagnitude=0.1`;
    
    const EMSC_URL = `https://www.seismicportal.eu/fdsnws/event/1/query?starttime=${startTime.toISOString().slice(0, 19)}&endtime=${endTime.toISOString().slice(0, 19)}&minmag=0.1&format=json&limit=3000`;

    
    const normalizeUsgs = (f) => {
        // Garante que a geometria e coordenadas existam
        if (!f.geometry || !f.geometry.coordinates) return null;
        return {
            ...f.properties,
            magnitude: f.properties.mag,
            geometry: f.geometry,
            source: 'USGS',
            id: f.id,
            lat: f.geometry.coordinates[1],
            lon: f.geometry.coordinates[0]
        };
    };

    const normalizeEmsc = (f) => {
        if (!f.properties || f.properties.lat == null || f.properties.lon == null) return null;
        return {
            magnitude: f.properties.mag,
            place: f.properties.flynn_region,
            time: new Date(f.properties.time).getTime(),
            depth: f.properties.depth,
            id: f.id,
            geometry: { coordinates: [f.properties.lon, f.properties.lat, f.properties.depth] },
            source: f.properties.auth || 'EMSC',
            lat: f.properties.lat,
            lon: f.properties.lon
        };
    };

    const fetchPromises = [
        fetch(USGS_URL).then(res => res.ok ? res.json() : { features: [] }),
        fetch(EMSC_URL).then(res => res.ok ? res.json() : { features: [] })
    ];

    const results = await Promise.allSettled(fetchPromises);
    let allSismosRaw = [];

    if (results[0].status === 'fulfilled' && results[0].value.features) allSismosRaw.push(...results[0].value.features.map(normalizeUsgs));
    if (results[1].status === 'fulfilled' && results[1].value.features) allSismosRaw.push(...results[1].value.features.map(normalizeEmsc));

    
    const uniqueSismos = Array.from(new Map(allSismosRaw.map(s => [s.id || `${Math.round(s.time/60000)}-${s.magnitude}`, s])).values());
    return uniqueSismos;
}


// --- 3. FUNÇÕES DE CÁLCULO ---
async function calculateDailyStats() {
    const now = new Date();
    const yesterday = new Date(now.getTime() - (24 * 60 * 60 * 1000));
    const sismos = await fetchCombinedQuakeData(yesterday, now);
    const sortedSismos = sismos.sort((a, b) => a.time - b.time);

    const magCounts = {};
    sortedSismos.forEach(quake => {
        
        const magFloor = Math.floor(quake.magnitude);
        const key = `M${magFloor}`;
        magCounts[key] = (magCounts[key] || 0) + 1;
    });
    const sortedMagKeys = Object.keys(magCounts).sort((a, b) => parseInt(a.substring(1)) - parseInt(b.substring(1)));
    const filteredMagCounts = {};
    sortedMagKeys.forEach(key => { filteredMagCounts[key] = magCounts[key]; });

    const timeWindow = 24 * 60 * 60 * 1000;
    const scatterPlotPoints = sortedSismos.map(sismo => {
        const timeAgo = now - sismo.time;
        const left = (1 - (timeAgo / timeWindow)) * 100;
        const depth = Math.max(0, sismo.depth || (sismo.geometry ? sismo.geometry.coordinates[2] : 0));
        const { formattedDate, formattedTime } = formatEarthquakeDateTime(sismo.time);
        
        return {
            left, depth, size: 4 + (sismo.magnitude * 1.5), color: getSismoColor(sismo.magnitude),
            info: `M${sismo.magnitude.toFixed(1)} @ ${depth.toFixed(1)}km<br>${formattedDate}<br>${formattedTime}`
        };
    });

    const mapReplayPoints = sortedSismos.map(sismo => {
        if (!sismo.geometry || !sismo.geometry.coordinates) return null;
        
        return { lon: sismo.geometry.coordinates[0], lat: sismo.geometry.coordinates[1], mag: sismo.magnitude, color: getSismoColor(sismo.magnitude) };
    }).filter(p => p && p.lon != null && p.lat != null);

    return {
        stats: {
            totalSismos: sismos.length,
            magCounts: filteredMagCounts,
            scatterPlotPoints: scatterPlotPoints,
            mapReplayPoints: mapReplayPoints
        },
        sismos: sortedSismos
    };
}

async function calculateWeeklyStats() {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000));
    const sismos = await fetchCombinedQuakeData(sevenDaysAgo, now);
    const sortedSismos = sismos.sort((a, b) => a.time - b.time);

    const magFilterStats = { range1: 0, range_M3: 0, range_M4: 0, range_M5: 0, range_M6: 0, range_M7: 0, range_M8: 0, range_M9plus: 0 };
    sortedSismos.forEach(sismo => {
        
        const magnitude = sismo.magnitude;
        if (magnitude >= 9.0) magFilterStats.range_M9plus++;
        else if (magnitude >= 8.0) magFilterStats.range_M8++;
        else if (magnitude >= 7.0) magFilterStats.range_M7++;
        else if (magnitude >= 6.0) magFilterStats.range_M6++;
        else if (magnitude >= 5.0) magFilterStats.range_M5++;
        else if (magnitude >= 4.0) magFilterStats.range_M4++;
        else if (magnitude >= 3.0) magFilterStats.range_M3++;
        else if (magnitude >= 0.1) magFilterStats.range1++;
    });

    const dailyData = {};
    for (let i = 0; i < 7; i++) {
        const d = new Date(now - (i * 24 * 60 * 60 * 1000));
        const key = d.toISOString().split('T')[0];
        dailyData[key] = { count: 0, maxMag: 0, date: d };
    }
    sortedSismos.forEach(quake => {
        const key = new Date(quake.time).toISOString().split('T')[0];
        if (dailyData[key]) {
            dailyData[key].count++;
            // CORREÇÃO: Modificado para usar 'magnitude'
            if (quake.magnitude > dailyData[key].maxMag) dailyData[key].maxMag = quake.magnitude;
        }
    });
    const weeklyBarData = Object.values(dailyData).sort((a, b) => a.date - b.date).map(d => ({
        count: d.count, maxMag: d.maxMag, dayLabel: translations_en_fake.weekdays[d.date.getDay()],
        dateKey: d.date.toISOString().split('T')[0]
    }));
    
    const sevenDaysInMillis = 7 * 24 * 60 * 60 * 1000;
    const weeklyScatterPoints = sortedSismos.map(sismo => {
        const timeAgo = now - sismo.time;
        const left = (1 - (timeAgo / sevenDaysInMillis)) * 100;
        const depth = Math.max(0, sismo.depth || (sismo.geometry ? sismo.geometry.coordinates[2] : 0));
        const { formattedDate, formattedTime } = formatEarthquakeDateTime(sismo.time);
        
        return {
            left, depth, size: 3 + (sismo.magnitude * 1.2), color: getSismoColor(sismo.magnitude),
            info: `M${sismo.magnitude.toFixed(1)} @ ${depth.toFixed(1)}km<br>${formattedDate}<br>${formattedTime}`,
            mag: sismo.magnitude, dateKey: new Date(sismo.time).toISOString().split('T')[0]
        };
    });

    const mapReplayPoints = sortedSismos.map(sismo => {
        if (!sismo.geometry || !sismo.geometry.coordinates) return null;
        
        return { lon: sismo.geometry.coordinates[0], lat: sismo.geometry.coordinates[1], mag: sismo.magnitude, color: getSismoColor(sismo.magnitude) };
    }).filter(p => p && p.lon != null && p.lat != null);

    return {
        stats: {
            totalSismos: sortedSismos.length,
            magFilterStats: magFilterStats,
            weeklyBarData: weeklyBarData,
            weeklyScatterPoints: weeklyScatterPoints,
            mapReplayPoints: mapReplayPoints
        },
        sismos: sortedSismos
    };
}

// --- 4. FUNÇÃO PRINCIPAL (MAIN) DO SCRIPT ---
async function runAnalysis() {
    console.log("Iniciando processo de análise de backend...");
    try {
        const [dailyResult, weeklyResult] = await Promise.all([
            calculateDailyStats(),
            calculateWeeklyStats()
        ]);
        
        const finalCacheObject = {
            lastUpdated: new Date().toISOString(),
            daily: {
                ...dailyResult.stats,
                sismos: dailyResult.sismos
            },
            weekly: {
                ...weeklyResult.stats,
                sismos: weeklyResult.sismos
            }
        };

        fs.writeFileSync('stats_cache.json', JSON.stringify(finalCacheObject, null, 2));
        
        console.log("SUCESSO: stats_cache.json foi criado.");
        console.log(`Resumo: ${finalCacheObject.daily.totalSismos} sismos (24h), ${finalCacheObject.weekly.totalSismos} sismos (7d).`);

    } catch (error) {
        console.error("ERRO FATAL durante o processamento das estatísticas:", error);
        process.exit(1);
    }
}

// Inicia o processo
runAnalysis();

