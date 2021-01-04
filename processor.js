const fs = require('fs')
const schedule = require('node-schedule');
const scrap = require('jofogas-scrapper');
const send = require('./mailer')

class Processor
{

    routines;
    schedules;
    notifications;

    start()
    {   
        fs.readFile('data/routines.json', (err, data) =>
        {
            if(!err)
            {
                this.routines = JSON.parse(data)
            }
            else
            {
                this.routines = []
                console.error('data/routines.json cant be loaded.')
            }

            let scrapper = schedule.scheduleJob('*/1 * * * *', this.sracp.bind(this))
            let notifier  = schedule.scheduleJob('*/2 * * * *', this.nofity.bind(this))
            this.schedules = [scrapper, notifier]

            this.notifications = []
            console.log("Processor is running.")
        })
    }

    
    schedule()
    {

    }

    sracp()
    {
        for(let routine of this.routines)
        {
            let settings = {
                depht: 10,
                domain: routine.domain,
                minPrice : routine.min,
                maxPrice : routine.max,
                sleep : Math.floor(Math.random() * Math.floor(2000)),
                enableCompany : false,
                enablePost: false
            }

            scrap(routine.keyword, settings, items =>
            {
                for(let item of items)
                    if(!this.notifications.find(pre => pre.id == item.id))
                        this.notifications.push(item)
                console.log(`[Srapper] ${routine.keyword} scrapped, itmes in notify: ${this.notifications.length} at ${(new Date()).toString()}`)
            })
            
        }
    }

    nofity()
    {
        let date = new Date()
        let dateText = `JWatcher report (${date.getMonth()+1}/${(date.getDay())})`
        let toBeNotified = this.notifications.filter(n => !n.sent)
            
        if(toBeNotified.length > 0)
        {
            send(dateText, `${toBeNotified.length} deal aviable`, this.createNiceReport(toBeNotified))
            toBeNotified.forEach(item => {item.sent = true})
        }
        else
            console.log("[Notify] no new deal aviable.")
    }

    createNiceReport(items)
    {
        return JSON.stringify(items)
    }
}

module.exports = Processor