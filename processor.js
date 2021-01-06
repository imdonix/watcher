const fs = require('fs')
const ejs = require('ejs');
const schedule = require('node-schedule');
const scrap = require('jofogas-scrapper');
const send = require('./mailer')
const settings = require('./settings')

class Processor
{

    routines
    schedules
    notifications

    start()
    {   
        this.memoryLoad()
        .then(this.routineLoad())
        .then(() =>
        {
            let scrapper = schedule.scheduleJob(`*/${settings.SCRAP} * * * *`, this.scrap.bind(this))
            let notifier  = schedule.scheduleJob(`* ${settings.NOTIFY} * * *`, this.nofity.bind(this))
            this.schedules = [scrapper, notifier]
    
            console.log("[Processor] running.")
        })
        .catch(err =>
        {
            console.log("!! [Processor] cant be started.")
        })
    }

    reloadRoutines()
    {
        this.routineLoad()
        .then(() => 
        {
            console.log("[Processor] reload done.")
        })
        .catch(err =>
        {
            console.log("[Processor] reload failed.")
        })
    }

    getMemory()
    {
        return this.notifications;
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
                    this.notifications = []

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
            let settings = {
                depht: 10,
                domain: routine.domain,
                minPrice : routine.min,
                maxPrice : routine.max,
                sleep : Math.floor(Math.random() * Math.floor(2000)) + 100,
                enableCompany : false,
                enablePost: false
            }

            scrap(routine.keyword, settings, items =>
            {
                for(let item of items)
                    if(!this.notifications.find(pre => pre.id == item.id))
                    {
                        item.found = this.niceDate()
                        this.notifications.push(item)
                    }
                console.log(`[${this.niceDate()}] [Srapper] {${routine.keyword}} found: ${items.length}, items in memory: ${this.notifications.length}`)
            })
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
            .catch(error =>
            {
                console.log(`[${this.niceDate()}] [Notify] Mail cant be sent: ${error}`);
            })
        }
        else
            console.log(`[${this.niceDate()}] [Notify] no new deal aviable.`)
    }

    createNiceReport(items)
    {
        this.preatyPrice(items)
        let html = ejs.render(fs.readFileSync('./public/mail.ejs', 'utf-8'), {items: items});
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

        for(let item of items)
            item.price = numberWithCommas(item.price)
    }
}

module.exports = Processor