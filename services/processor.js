const { Sequelize } = require('sequelize')
const ejs = require('ejs');
const schedule = require('node-schedule');
const fs = require('fs')

const { User, Routine, Item } = require('./db')
const { niceDate } = require('./time')
const send = require('./mailer')
const { settings } = require('./cfg');

const Jofogas = require('../srappers/jofogas');
const Ingatlan = require('../srappers/ingatlan');
const Auto = require('../srappers/auto');

class Processor
{
    scrappers;
    schedules;

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

        this.scrappers = [jofogas, ingatlan, auto]
        console.log(`[${niceDate()}] [Processor] Scrappers loaded. (${this.scrappers.length})`)
        return Promise.resolve()
    }

    async scrapAll()
    {
        const Op = Sequelize.Op

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

                console.log(`[${niceDate()}] [${engine.name}/${routine.keywords}] found: ${founds.length}`)
            }
            else
                console.error(`[${niceDate()}] [Processor] !! Scrap engine does not exist with this id: ${routine.engine}`)
        }


        console.log((await Item.findAll()).length)

    }

    async nofity()
    {
        let total = 0
        const users = await User.findAll()

        for (const user of users) 
        {
            
            let dateText = `Report ${niceDate()}`
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
                    await send(dateText, `${toBeNotified.length} deal aviable`, user.name , this.createNiceReport(toBeNotified))
                    
                    for (const item of toBeNotified)
                    {
                        item.sent = true
                        await item.save()
                    }

                    total += toBeNotified.length

                    console.log(`[${niceDate()}] [Notify] Message sent to ${user.name}! (${toBeNotified.length})`)
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
            console.log(item.sent)
            return newItem
        })
    }
}

module.exports = Processor