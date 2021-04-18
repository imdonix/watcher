const express = require('express')
const fs = require('fs')

const settings = require('./settings')
const Processor = require('./services/processor')
const { cyrb53 } = require('./services/crypto')

const app = express()
const proc = new Processor()

app.use(express.json()); 
app.use(express.static('public'))

app.post('/upload', (req,res) =>
{
    let data = req.body.data;
    let pass = req.body.pass
    if(data)
    {
        if((pass && pass == cyrb53(settings.MASTER)) || settings.DEV)
        {
            fs.writeFile('./data/routines.json', JSON.stringify(data), () => 
            {
                proc.reloadRoutines()
                res.status(200).send()
            })
        }
        else
            res.status(401).send()
    }
    else
        res.status(500).send()
})

app.get('/download', (_,res) => 
{
    fs.readFile('./data/routines.json', (err, data) =>
    {
        if(err) res.status(500).send()
        else res.send(data)
    })
})

app.get('/memory', (_,res) => 
{
    res.json(proc.getMemory())
})

app.get('/scrappers', (_,res) => 
{
    res.json(proc.getScrappers())
})

app.post('/notify', (_,res) => 
{
    proc.nofity()
    .then((sent) => res.status(200).send({sent}))
    .catch((err) => res.status(500).send(err))
})

app.post('/scrap', (_,res) => 
{
    proc.scrap()
    .then(() => res.status(200).send())
})

proc.start()
.then(() => app.listen(settings.PORT, () => console.log(`[HTTP] started on (${settings.PORT})`)))