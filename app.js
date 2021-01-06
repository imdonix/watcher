const express = require('express')
const fs = require('fs')
const settings = require('./settings')
const Processor = require('./processor')
const { cyrb53 } = require('./crypto')
const { request } = require('http')

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
        if(pass && pass == cyrb53(settings.MASTER))
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

app.post('/download', (_,res) => 
{
    fs.readFile('./data/routines.json', (err, data) =>
    {
        if(err) res.status(500).send()
        else res.send(data)
    })
})

app.post('/memory', (_,res) => 
{
    res.json(proc.getMemory())
})


proc.start()
app.listen(settings.PORT, () => console.log(`App started on (${settings.PORT})`))