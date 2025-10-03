// Este é o ficheiro que o teu GitHub Action vai executar.
// Vamos chamá-lo: processar_stats.js
// Ele precisa da biblioteca 'node-fetch': npm install node-fetch
// No final, ele precisa de 'fs' (file-system) para escrever o JSON.

const fetch = require('node-fetch');
const fs = require('fs');

// --- 1. FUNÇÕES DE AJUDA GLOBAIS ---
// (Estas são copiadas do teu main.js, pois o servidor não as conhece)

const translations_en_fake = { // Precisamos de um mini-objeto de tradução para os dias da semana
    weekdays: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
    ago: { d: "{n}d", s: "now" } // Apenas placeholders, caso sejam necessários
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
    const monthIndex = date.getMonth(); // Simplesmente o índice
    const year = date.getFullYear();
    const optionsTime = { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short', hour12: false };
    const timeStr = new Intl.DateTimeFormat('en-US', optionsTime).format(date); // Usamos 'en-US' como padrão de servidor
    return { formattedDate: `${day}/${monthIndex + 1}/${year}`, formattedTime: timeStr };
}

// --- 2. LÓGICA DE BUSCA DE DADOS ---

async function fetchCombinedQuakeData(startTime, endTime) {
    const USGS_URL = `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&starttime=${startTime.toISOString()}&endtime=${endTime.toISOString()}&minmagnitude=1.0`;
    const EMSC_URL = `https://www.seismicportal.eu/fdsnws/event/1/query?starttime=${startTime.toISOString().slice(0, -5)}Z&endtime=${endTime.toISOString().slice(0, -5)}Z&minmag=1.0&format=json&limit=2000`;

    const normalizeUsgs = (f) => ({ ...f.properties, geometry: f.geometry, source: 'USGS' });
    const normalizeEmsc = (f) => ({
        mag: f.properties.mag, place: f.properties.flynn_region, time: new Date(f.properties.time).getTime(),
        depth: f.properties.depth,
        geometry: { coordinates: [f.properties.lon, f.properties.lat, f.properties.depth] }, source: f.properties.auth || 'EMSC'
    });

    const fetchPromises = [
        fetch(USGS_URL).then(res => res.ok ? res.json() : { features: [] }),
        fetch(EMSC_URL).then(res => res.ok ? res.json() : { features: [] })
    ];

    const results = await Promise.allSettled(fetchPromises);
    let allSismosRaw = [];

    if (results[0].status === 'fulfilled') allSismosRaw.push(...results[0].value.features.map(normalizeUsgs));
    if (results[1].status === 'fulfilled') allSismosRaw.push(...results[1].value.features.map(normalizeEmsc));

    const uniqueSismos = Array.from(new Map(allSismosRaw.map(s => [`${Math.round(s.time/60000)}-${s.mag.toFixed(1)}`, s])).values());
    return uniqueSismos; // Retorna os sismos não ordenados
}

// --- 3. NOVAS FUNÇÕES DE CÁLCULO (O "CÉREBRO" DO BACKEND) ---

/**
 * CALCULA APENAS as estatísticas de 24h. Não gera HTML.
 */
async function calculateDailyStats() {
    const now = new Date();
    const yesterday = new Date(now.getTime() - (24 * 60 * 60 * 1000));
    const sismos = await fetchCombinedQuakeData(yesterday, now);
    
    // ORDENA PRIMEIRO!
    const sortedSismos = sismos.sort((a, b) => a.time - b.time); // Ordena por tempo (antigo para novo)

    const magCounts = {};
    sortedSismos.forEach(quake => { // Usa a lista ordenada
        const magFloor = Math.floor(quake.mag);
        const key = `M${magFloor}`;
        magCounts[key] = (magCounts[key] || 0) + 1;
    });

    const sortedMagKeys = Object.keys(magCounts).sort((a, b) => parseInt(a.substring(1)) - parseInt(b.substring(1)));
    const filteredMagCounts = {};
    sortedMagKeys.forEach(key => {
        filteredMagCounts[key] = magCounts[key];
    });

    const depthScale = [
        { depth: 0, position: 0 }, { depth: 10, position: 10 }, { depth: 20, position: 20 },
        { depth: 50, position: 35 }, { depth: 100, position: 50 }, { depth: 400, position: 70 },
        { depth: 500, position: 78 }, { depth: 600, position: 86 }, { depth: 1000, position: 100 }
    ];
    const maxDepthInSismos = Math.max(...sismos.map(s => Math.abs(s.depth) || 0), 0); // Pode usar 'sismos' aqui, não importa a ordem
    const finalMaxDepth = depthScale.find(s => s.depth >= maxDepthInSismos)?.depth || 1000;

    const timeWindow = 24 * 60 * 60 * 1000;
    // CRÍTICO: Usa 'sortedSismos.map' para que os pontos estejam em ordem cronológica
    const scatterPlotPoints = sortedSismos.map(sismo => {
        const timeAgo = now - sismo.time;
        const left = (1 - (timeAgo / timeWindow)) * 100;
        const depth = Math.max(0, sismo.depth || (sismo.geometry ? sismo.geometry.coordinates[2] : 0));
        const size = 4 + (sismo.mag * 1.5);
        const color = getSismoColor(sismo.mag);
        const { formattedDate, formattedTime } = formatEarthquakeDateTime(sismo.time);
        const info = `M${sismo.mag.toFixed(1)} @ ${depth.toFixed(1)}km<br>${formattedDate}<br>${formattedTime}`;
        return { left, depth, size, color, info };
    });

    // Usa 'sortedSismos' que já foi criado
    const mapReplayPoints = sortedSismos.map(sismo => {
        if (!sismo.geometry || !sismo.geometry.coordinates || sismo.geometry.coordinates.length < 2) return null;
        const lon = sismo.geometry.coordinates[0];
        const lat = sismo.geometry.coordinates[1];
        if (lon == null || lat == null) return null;
        
        return {
            lon: lon,
            lat: lat,
            mag: sismo.mag,
            color: getSismoColor(sismo.mag)
        };
    }).filter(p => p !== null);

    return {
        stats: {
            totalSismos: sismos.length,
            magCounts: filteredMagCounts,
            maxDepth: maxDepthInSismos,
            gridMaxDepth: finalMaxDepth,
            depthScalePoints: depthScale.filter(s => s.depth <= finalMaxDepth),
            scatterPlotPoints: scatterPlotPoints,
            mapReplayPoints: mapReplayPoints
        },
        sismos: sortedSismos // Retorna a lista de sismos também
    };
}
/**
 * CALCULA APENAS as estatísticas de 7 Dias. Não gera HTML.
 */
async function calculateWeeklyStats() {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000));
    const sismos = await fetchCombinedQuakeData(sevenDaysAgo, now);

    // Declaração ÚNICA de sortedSismos (para todos os cálculos nesta função)
    const sortedSismos = sismos.sort((a, b) => a.time - b.time); 

    const magFilterStats = { range1: 0, range_M3: 0, range_M4: 0, range_M5: 0, range_M6: 0, range_M7: 0, range_M8: 0, range_M9plus: 0 };
    sortedSismos.forEach(sismo => { // Usa o sortedSismos já existente
        const mag = sismo.mag;
        if (mag >= 9.0) magFilterStats.range_M9plus++;
        else if (mag >= 8.0) magFilterStats.range_M8++;
        else if (mag >= 7.0) magFilterStats.range_M7++;
        else if (mag >= 6.0) magFilterStats.range_M6++;
        else if (mag >= 5.0) magFilterStats.range_M5++;
        else if (mag >= 4.0) magFilterStats.range_M4++;
        else if (mag >= 3.0) magFilterStats.range_M3++;
        else if (mag >= 0.1) magFilterStats.range1++;
    });

    const dailyData = {};
    for (let i = 0; i < 7; i++) {
        const d = new Date(now - (i * 24 * 60 * 60 * 1000));
        const key = d.toISOString().split('T')[0];
        dailyData[key] = { count: 0, maxMag: 0, date: d };
    }
    sortedSismos.forEach(quake => { // Usa o sortedSismos já existente
        const quakeDate = new Date(quake.time);
        const key = quakeDate.toISOString().split('T')[0];
        if (dailyData[key]) {
            dailyData[key].count++;
            if (quake.mag > dailyData[key].maxMag) dailyData[key].maxMag = quake.mag;
        }
    });
    const weeklyBarData = Object.values(dailyData).sort((a, b) => a.date - b.date).map(d => ({
        count: d.count,
        maxMag: d.maxMag,
        dayLabel: translations_en_fake.weekdays[d.date.getDay()],
        dateKey: d.date.toISOString().split('T')[0]
    }));
    
    const depthScale = [
        { depth: 0, position: 0 }, { depth: 10, position: 10 }, { depth: 20, position: 20 },
        { depth: 50, position: 35 }, { depth: 100, position: 50 }, { depth: 400, position: 70 },
        { depth: 500, position: 78 }, { depth: 600, position: 86 }, { depth: 1000, position: 100 }
    ];
    const maxDepthInSismos = Math.max(...sortedSismos.map(s => Math.abs(s.depth) || 0), 0);
    const finalMaxDepth = depthScale.find(s => s.depth >= maxDepthInSismos)?.depth || 1000;
    
    const sevenDaysInMillis = 7 * 24 * 60 * 60 * 1000;

    const weeklyScatterPoints = sortedSismos.map(sismo => {
        const timeAgo = now - sismo.time;
        const left = (1 - (timeAgo / sevenDaysInMillis)) * 100;
        const depth = Math.max(0, sismo.depth || (sismo.geometry ? sismo.geometry.coordinates[2] : 0));
        const size = 3 + (sismo.mag * 1.2);
        const color = getSismoColor(sismo.mag);
        const { formattedDate, formattedTime } = formatEarthquakeDateTime(sismo.time);
        const info = `M${sismo.mag.toFixed(1)} @ ${depth.toFixed(1)}km<br>${formattedDate}<br>${formattedTime}`;
        const sismoDateKey = new Date(sismo.time).toISOString().split('T')[0];
        return { left, depth, size, color, info, mag: sismo.mag, dateKey: sismoDateKey };
    });

    // --- ### CORREÇÃO 2: A LINHA DUPLICADA 'const sortedSismos' FOI APAGADA DAQUI ### ---

    const mapReplayPoints = sortedSismos.map(sismo => { // Agora usa o sortedSismos da linha 144
        if (!sismo.geometry || !sismo.geometry.coordinates || sismo.geometry.coordinates.length < 2) return null;
        const lon = sismo.geometry.coordinates[0];
        const lat = sismo.geometry.coordinates[1];
        if (lon == null || lat == null) return null;
        
        return {
            lon: lon,
            lat: lat,
            mag: sismo.mag,
            color: getSismoColor(sismo.mag)
        };
    }).filter(p => p !== null);

    return {
        stats: {
            totalSismos: sortedSismos.length,
            magFilterStats: magFilterStats,
            weeklyBarData: weeklyBarData,
            maxDepth: maxDepthInSismos,
            gridMaxDepth: finalMaxDepth,
            depthScalePoints: depthScale.filter(s => s.depth <= finalMaxDepth),
            weeklyScatterPoints: weeklyScatterPoints,
            mapReplayPoints: mapReplayPoints
        },
        sismos: sortedSismos // Retorna a lista de sismos também
    };


// --- 4. FUNÇÃO PRINCIPAL (MAIN) DO SCRIPT ---

async function runAnalysis() {
    console.log("Iniciando processo de análise de backend...");
    try {
        
        const dailyResult = await calculateDailyStats();
        const weeklyResult = await calculateWeeklyStats();
        

        const dailySismosList = dailyResult.sismos;
        const weeklySismosList = weeklyResult.sismos;

        dailyResult.stats.sismos = dailySismosList;
        weeklyResult.stats.sismos = weeklySismosList;

        const finalCacheObject = {
            lastUpdated: new Date().toISOString(),
            daily: dailyResult.stats,
            weekly: weeklyResult.stats
        };

        // Salva o resultado num ficheiro JSON
        fs.writeFileSync('stats_cache.json', JSON.stringify(finalCacheObject, null, 2));
        
        console.log("SUCESSO: stats_cache.json foi criado.");
        console.log(`Resumo: ${dailyResult.stats.totalSismos} sismos (24h), ${weeklyResult.stats.totalSismos} sismos (7d).`);

    } catch (error) {
        console.error("ERRO FATAL durante o processamento das estatísticas:", error);
    }
}

// Inicia o processo
runAnalysis();


