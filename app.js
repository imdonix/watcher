
const express = require('express')

const { niceDate } = require('./services/time')
const { initSettings, settings } = require('./services/cfg')

const { sequelize, User } = require('./services/db')

const Processor = require('./services/processor')
const API = require('./services/api')
const Telematic = require('./services/telematic')
const Executor = require('./services/executor')


const app = express()
const telematic = new Telematic()
const executor = new Executor()
const proc = new Processor(telematic, executor)
const api = new API(proc, executor)

app.use(express.json({limit: '50mb'}))
app.use(express.static('public'))


initSettings()
.then(() => sequelize.sync({ force: settings.clean }))
.then(() => User.create({name: 'Admin', pass: settings.mail_pass}, { ignoreDuplicates: true }))
.then(() => telematic.init())
.then(() => proc.start())
.then(() => app.use(api))
.then(() => app.listen(settings.port, () => console.log(`[${niceDate()}] [HTTP] started on (localhost:${settings.port})`)))