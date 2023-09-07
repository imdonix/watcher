const { Sequelize } = require('sequelize')
const ejs = require('ejs');
const schedule = require('node-schedule');
const fs = require('fs')

const { User, Routine, Item } = require('./db')
const { niceDate, dateOnly } = require('./time')
const { settings } = require('./cfg');

const Jofogas = require('../srappers/jofogas');
const Ingatlan = require('../srappers/ingatlan');
const Auto = require('../srappers/auto');

const EMAIL_REG = /^[a-zA-Z0-9_.+]*[a-zA-Z][a-zA-Z0-9_.+]*@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$/;

class Processor
{
    telematic;
    scrappers;
    schedules;

    constructor(telematic)
    {
        this.telematic = telematic
    }

    start()
    {   
        return Promise.resolve()
        .then(() => this.scrapperLoad())
        .then(() =>
        {

            let scrapper = schedule.scheduleJob(`*/${settings.dev ? 1 : settings.scrap} * * * *`, () => this.scrapAll().then())
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

    getScrappers()
    {
        return this.scrappers.map(scrap => {
            return {...scrap, options : scrap.getOptions()}
        })
    }

    scrapperLoad()
    {
        const jofogas = new Jofogas()
        const ingatlan = new Ingatlan()
        const auto = new Auto()

        this.scrappers = [jofogas]
        console.log(`[${niceDate()}] [Processor] Scrappers loaded. |${this.scrappers.map(x => x.name).join(' & ')}|`)
        return Promise.resolve()
    }

    async scrapAll()
    {
        const routines = await Routine.findAll()

        for(const routineIns of routines)
        {
            let routine = JSON.parse(routineIns.json)
            let engine = this.scrappers.find(scrapper => scrapper.id == routine.engine)

            if(engine)
            {
                let founds = await engine.scrap(routine)

                for(let found of founds)
                {
                    found.found = niceDate()
                    await Item.create({
                        id: found.id,
                        sent: false,
                        owner: routineIns.owner,
                        json: JSON.stringify(found)
                    }, {
                        ignoreDuplicates: true
                    })
                    
                }

                console.log(`[${niceDate()}] [Scrap] /${engine.name}->${routine.keywords}/ found: ${founds.length}`)
            }
            else
                console.error(`[${niceDate()}] [Processor] !! Scrap engine does not exist with this id: ${routine.engine}`)
        }


        console.log(`[${niceDate()}] [Processor] Scrapping finished, currently '${(await Item.count())}' item in the database`)
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