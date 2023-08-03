
const express = require('express')

const { niceDate } = require('./services/time')
const { initSettings, settings } = require('./services/cfg')
const Processor = require('./services/processor')
const API = require('./services/api')
const { sequelize, User } = require('./services/db')

const app = express()
const proc = new Processor()
const api = new API(proc)

app.use(express.json()); 
app.use(express.static('public'))


initSettings()
.then(() => sequelize.sync({ force: settings.clean }))
.then(() => User.create({name: 'Admin', pass: settings.mail_pass}, { ignoreDuplicates: true }))
.then(() => proc.start())
.then(() => app.use(api))
.then(() => app.listen(settings.port, () => console.log(`[${niceDate()}] [HTTP] started on (${settings.port})`)))