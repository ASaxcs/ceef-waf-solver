require('dotenv').config()
const express = require('express')
const app = express()
const port = process.env.PORT || process.env.SERVER_PORT || 7860
const bodyParser = require('body-parser')
const authToken = process.env.authToken || null
const cors = require('cors')
const reqValidate = require('./module/reqValidate')
const { initWebSocket } = require('./module/wsServer')

global.browserLength = 0
global.browserLimit = Number(process.env.browserLimit || process.env.MAX_CONCURRENT || 20)
global.timeOut = Number(process.env.timeOut || process.env.SOLVER_TIMEOUT || 120000)

app.use(bodyParser.json({ limit: '10mb' }))
app.use(bodyParser.urlencoded({ extended: true }))
app.use(cors())

// Root endpoint for health check
app.get('/', (req, res) => {
    res.status(200).json({
        status: true,
        message: "CEEF WAF Solver is running (HTTP + WebSocket enabled)",
        port: port,
        wsEndpoint: `ws://host:${port}/ws`,
        browserReady: !!global.browser,
        activeJobs: global.browserLength || 0,
        supportedModes: ["source", "turnstile-min", "turnstile-max", "waf-session", "auto", "pinjam-ip"]
    });
});

let server = null;
if (process.env.NODE_ENV !== 'development') {
    server = app.listen(port, () => {
        console.log(`🚀 Server running on port ${port}`)
        initWebSocket(server);
    })
    try {
        server.timeout = global.timeOut
    } catch (e) { }
}

if (process.env.SKIP_LAUNCH != 'true') require('./module/createBrowser')

const getSource = require('./endpoints/getSource')
const solveTurnstileMin = require('./endpoints/solveTurnstile.min')
const solveTurnstileMax = require('./endpoints/solveTurnstile.max')
const wafSession = require('./endpoints/wafSession')
const solveAuto = require('./endpoints/solveAuto')
const solvePinjamIp = require('./endpoints/solvePinjamIp')

app.post('/cf-clearance-scraper', async (req, res) => {

    const data = req.body

    const check = reqValidate(data)

    if (check !== true) return res.status(400).json({ code: 400, message: 'Bad Request', schema: check })

    if (authToken && data.authToken !== authToken) return res.status(401).json({ code: 401, message: 'Unauthorized' })

    if (global.browserLength >= global.browserLimit) return res.status(429).json({ code: 429, message: 'Too Many Requests' })

    if (process.env.SKIP_LAUNCH != 'true' && !global.browser) return res.status(500).json({ code: 500, message: 'The scanner is not ready yet. Please try again a little later.' })

    var result = { code: 500 }

    global.browserLength++

    try {
        switch (data.mode) {
            case "source":
                result = await getSource(data).then(res => ({ source: res, code: 200 }));
                break;
            case "turnstile-min":
                result = await solveTurnstileMin(data).then(res => ({ token: res, code: 200 }));
                break;
            case "turnstile-max":
                result = await solveTurnstileMax(data).then(res => ({ token: res, code: 200 }));
                break;
            case "waf-session":
                result = await wafSession(data).then(res => ({ ...res, code: 200 }));
                break;
            case "auto":
                result = await solveAuto(data).then(res => ({ ...res, code: 200 }));
                break;
            case "pinjam-ip":
            case "ip-bound":
                result = await solvePinjamIp(data).then(res => ({ ...res, code: 200 }));
                break;
        }
    } catch (err) {
        result = { code: 500, message: err.message || String(err) };
    } finally {
        global.browserLength--
    }

    res.status(result.code ?? 500).send(result)
})

app.use((req, res) => { res.status(404).json({ code: 404, message: 'Not Found' }) })

if (process.env.NODE_ENV == 'development') module.exports = app
