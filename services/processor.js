const fs = require('fs')
const ejs = require('ejs');
const schedule = require('node-schedule');
const scrap = require('jofogas-scrapper');

const send = require('./mailer')
const settings = require('../settings');
const Jofogas = require('../srappers/jofogas');

class Processor
{
    scrappers;
    schedules;
    notifications;
    routines;

    start()
    {   
        return Promise.resolve()
        .then(() => this.memoryLoad())
        .then(() => this.routineLoad())
        .then(() => this.scrapperLoad())
        .then(() =>
        {
            let scrapper = schedule.scheduleJob(`*/${settings.DEV ? 1 : settings.SCRAP} * * * *`, this.scrap.bind(this))
            let notifier  = schedule.scheduleJob(`0 ${settings.NOTIFY} * * *`, this.nofity.bind(this))
            this.schedules = [scrapper, notifier]
    
            console.log("[Processor] running.")
        })
        .catch(err =>console.error(`!! [Processor] cant be started. ${err}`))
    }

    getMemory()
    {
        return this.preatyPrice(this.notifications);
    }

    getScrappers()
    {
        return this.scrappers.map(scrap => {
            return {... scrap, options : scrap.getOptions()}
        })
    }

    reloadRoutines()
    {
        this.routineLoad()
        .then(() => console.log("[Processor] reload done."))
        .catch(err => console.error(`[Processor] reload failed. ${err}`))
    }

    scrapperLoad()
    {
        let jofogas = new Jofogas()
        
        this.scrappers = [jofogas]
        console.log("[Processor] Scrappers loaded.")
        return Promise.resolve()
    }

    memoryLoad()
    {
        return new Promise(res =>
        {
            fs.readFile('data/memory.json', (err, data) =>
            {
                if(!err)
                {
                    this.notifications = JSON.parse(data)
                    console.log('[Processor] Memory loaded.')
                }
                else
                {
                    this.notifications = []
                    console.error(`[Processor] Memory can't be loaded. ${err}`)
                }
                res()
            })
        })
    }

    routineLoad()
    {
        return new Promise((res, rej) =>
        {
            fs.readFile('data/routines.json', (err, data) =>
            {
                if(!err)
                {
                    this.routines = JSON.parse(data)
                    console.log('[Processor] Routines loaded.')
                    res()
                }
                else
                {
                    this.routines = []
                    console.error('!! [Processor] Routines cant be loaded. ' + err)
                    rej(err)
                }
            })
        })
    }

    scrap()
    {
        for(let routine of this.routines)
        {
            let engine = this.scrappers.find(scrapper => scrapper.id == routine.engine)

            if(engine)
            {
                engine.scrap(routine)
                .then(items => 
                {
                    for(let item of items)
                    if(!this.notifications.find(pre => pre.id == item.id))
                    {
                        item.found = this.niceDate()
                        this.notifications.push(item)
                    }
                    console.log(`[${this.niceDate()}] [${engine.name}] {${routine.keywords}} found: ${items.length} [${this.notifications.length}]`)
                })
            }
            else
                console.error(`!! [Processor] Scrap engine does not exist with this id: ${routine.engine}`)
        }
    }

    nofity()
    {
        let dateText = `Report! (${this.niceDate()})`
        let toBeNotified = this.notifications.filter(n => !n.sent)
            
        if(toBeNotified.length > 0)
        {
            send(dateText, `${toBeNotified.length} deal aviable`, this.createNiceReport(toBeNotified))
            .then(() => 
            {
                console.log(`[${this.niceDate()}] [Notify] Message sent! (${toBeNotified.length})`);
                this.remember(toBeNotified)
            })
            .catch(error => console.error(`[${this.niceDate()}] [Notify] Mail can't be sent: ${error}`))
        }
        else
            console.log(`[${this.niceDate()}] [Notify] no new deal aviable.`)
    }

    createNiceReport(items)
    {
        let preaty = this.preatyPrice(items)
        let html = ejs.render(fs.readFileSync('./views/mail.ejs', 'utf-8'), {items: preaty});
        return html
    }

    niceDate()
    {
        let date = new Date()
        return `${date.getMonth()+1}/${date.getDate()} ${date.getHours()}:${date.getMinutes()}`
    }

    remember(items)
    {
        items.forEach(item => item.sent = true )
        fs.writeFileSync('data/memory.json', JSON.stringify(this.notifications))
    }

    preatyPrice(items)
    {
        function numberWithCommas(x) 
        {
            return x.toString().replace(/\B(?<!\.\d*)(?=(\d{3})+(?!\d))/g, " ");
        }

        return items.map(item => {
            let newItem = {...item}
            newItem.price = numberWithCommas(item.price)
            return newItem
        })
    }
}

module.exports = Processor