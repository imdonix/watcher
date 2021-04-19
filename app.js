const express = require('express')
const settings = require('./settings')
const Processor = require('./services/processor')
const API = require('./services/api')

const app = express()
const proc = new Processor()
const api = new API(proc)

app.use(express.json()); 
app.use(express.static('public'))

proc.start()
.then(() => app.use(api))
.then(() => app.listen(settings.PORT, () => console.log(`[HTTP] started on (${settings.PORT})`)))