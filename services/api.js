const { Router } = require('express');
const { cyrb53 } = require('./crypto')

module.exports = class API extends Router
{
    constructor(proc)
    {
        super()
        this.proc = proc

        this.post('/upload', (req,res) =>
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
        
        this.get('/download', (_,res) => 
        {
            fs.readFile('./data/routines.json', (err, data) =>
            {
                if(err) res.status(500).send()
                else res.send(data)
            })
        })
        
        this.get('/memory', (_,res) => 
        {
            res.json(this.proc.getMemory())
        })
        
        this.get('/scrappers', (_,res) => 
        {
            res.json(this.proc.getScrappers())
        })
        
        this.post('/notify', (_,res) => 
        {
            this.proc.nofity()
            .then((sent) => res.status(200).send({sent}))
            .catch((err) => res.status(500).send(err))
        })
        
        this.post('/scrap', (_,res) => 
        {
            this.proc.scrap()
            .then(() => res.status(200).send())
        })

    }
}