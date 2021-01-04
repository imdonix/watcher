const express = require('express')
const path = require('path')
const settings = require('./settings')
const Processor = require('./processor')
const { request } = require('http')

const app = express()
const proc = new Processor()

app.listen(settings.PORT, () => console.log(`API running on (${settings.PORT})`))
proc.start()

