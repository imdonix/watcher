const { Router } = require('express');
const { Routine, User } = require('./db')
const { auth } = require('./auth')
const { niceDate } = require('./time')

module.exports = class API extends Router
{
    constructor(proc)
    {
        super()
        this.proc = proc

        this.post('/login', auth, (req, res) => 
        {
            console.log(`[${niceDate()}] [API] Login /${res.locals.user}/`)

            res.status(200).send({ name : res.locals.user })
        })

        this.post('/upload', auth, async (req,res) =>
        {
            console.log(`[${niceDate()}] [API] Upload routines /${res.locals.user}/`)

            let routines = req.body.data;
            
            await Routine.destroy({
                where: {
                    owner: res.locals.user
                }
            })
            
            for (const data of routines) 
            {
                await Routine.create({
                    owner: res.locals.user,
                    json: JSON.stringify(data)
                })
            }

            res.status(200).send()
        })
        
        this.post('/download', auth , async (_,res) => 
        {
            console.log(`[${niceDate()}] [API] Download routines /${res.locals.user}/`)

            const items = await Routine.findAll({
                where: {
                    owner: res.locals.user
                }
            })

            res.send(items.map(item => JSON.parse(item.json)))
        })
        
        this.post('/memory', auth , async (_,res) => 
        {
            console.log(`[${niceDate()}] [API] Items /${res.locals.user}/`)

            res.json(await this.proc.getMemory(res.locals.user))
        })
        
        this.get('/scrappers', (_,res) => 
        {
            console.log(`[${niceDate()}] [API] Request scrappers`)

            res.json(this.proc.getScrappers())
        })
        
        this.post('/notify', auth, (_,res) => 
        {
            console.log(`[${niceDate()}] [API] Force Notify`)

            this.proc.nofity()
            .then((sent) => res.status(200).send({sent}))
            .catch((err) => res.status(500).send(err))
        })
        
        this.post('/scrap', (_,res) => 
        {
            console.log(`[${niceDate()}] [API] Force Scrap`)

            this.proc.scrapAll()
            .then(() => res.status(200).send())
        })

        this.post('/newuser', auth , async (req, res) => 
        {
            console.log(`[${niceDate()}] [API] Create user /${res.locals.user}/`)

            User.create({
                name: req.body.newname,
                pass: req.body.newpass
            })

            console.log(`[${niceDate()}] [API] User created -> ${req.body.newname}`)
            
            res.status(200).send()  
        })

        this.post('/dev', (req, res) =>
        {
            console.log(`[${niceDate()}] [DEV/Response] ${req.body}`)
            res.status(200).send()
        })

    }
}