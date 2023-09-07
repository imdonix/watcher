const fs = require('fs')
const ejs = require('ejs');
const schedule = require('node-schedule');

const { User, Routine, Item } = require('./db')
const { niceDate, dateOnly } = require('./time')
const { settings } = require('./cfg');

const EMAIL_REG = /^[a-zA-Z0-9_.+]*[a-zA-Z][a-zA-Z0-9_.+]*@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$/;

class Processor
{
    executor;
    telematic;
    scrappers;
    schedules;

    constructor(telematic, executor)
    {
        this.telematic = telematic
        this.executor = executor
    }

    start()
    {   
        return Promise.resolve()
        .then(() =>
        {

            let scrapper = schedule.scheduleJob(`*/${settings.dev ? 1 : settings.scrap} * * * *`, () => this.enqueueRoutines().then())
            let notifier  = schedule.scheduleJob(`0 ${settings.notify} * * *`, () => this.nofity().then().catch())

            this.schedules = [scrapper, notifier]
    
            console.log(`[${niceDate()}] [Processor] live.`)
        })
        .catch(err => console.error(`[${niceDate()}] !! [Processor] cant be started. ${err}`))
    }

    getMemory(user)
    {
        return Item.findAll({
            where: {
                owner: user
            }
        })
        .then((items) =>
        { 
            return this.preapareItems(items);
        })
    }

    async enqueueRoutines()
    {
        const routines = await Routine.findAll()
        for(const routineIns of routines)
        {
            this.executor.enqueue(routineIns.owner, JSON.parse(routineIns.json), 0)
        }

        console.log(`[${niceDate()}] [Processor] ${routines.length} routine are enqueued.`)
    }

    async nofity()
    {
        let total = 0
        const users = await User.findAll()

        for (const user of users) 
        {
            if (user.name.match(EMAIL_REG))
            {
                let dateText = `Report ${dateOnly()}`
                let toBeNotified = await Item.findAll({
                    where: {
                        owner: user.name,
                        sent: false
                    }
                })
                
                if(toBeNotified.length > 0)
                {
                    try 
                    {
                        if(await this.telematic.send(dateText, user.name, toBeNotified, this.createNiceReport(toBeNotified)))
                        {
                        
                            for (const item of toBeNotified)
                            {
                                item.sent = true
                                await item.save()
                            }
        
                            total += toBeNotified.length
        
                            console.log(`[${niceDate()}] [Notify] Message sent to ${user.name}! (${toBeNotified.length})`)
                        }
                    } 
                    catch (error) 
                    {
                        console.error(`[${niceDate()}] [Notify] Mail can't be sent to ${user.name}: ${error}`)
                    }
                }
                else
                {
                    console.log(`[${niceDate()}] [Notify] no new deal aviable for ${user.name}.`)
                }     
            }
        }

        console.log(`[${niceDate()}] [Notify] total of ${total} deals are sent out.`)
        return total
    }

    createNiceReport(items)
    {
        let preaty = this.preapareItems(items)
        let html = ejs.render(fs.readFileSync('./views/mail.ejs', 'utf-8'), {items: preaty});
        return html
    }

    preapareItems(items)
    {
        function numberWithCommas(x) 
        {
            return x.toString().replace(/\B(?<!\.\d*)(?=(\d{3})+(?!\d))/g, " ");
        }

        return items.map(item => {
            let newItem = {...JSON.parse(item.json)}
            newItem.price = numberWithCommas(newItem.price)
            newItem.sent = item.sent

            return newItem
        })
    }
}

module.exports = Processor