
const express = require('express')

const settings = require('./services/cfg')
const Processor = require('./services/processor')
const API = require('./services/api')

const app = express()
const proc = new Processor()
const api = new API(proc)

app.use(express.json()); 
app.use(express.static('public'))


proc.start()
.then(() => app.use(api))
.then(() => app.listen(settings().port, () => console.log(`[HTTP] started on (${settings().port})`)))