const { Item } = require('./db')

const Jofogas = require('../srappers/jofogas');
const Ingatlan = require('../srappers/ingatlan');
const Auto = require('../srappers/auto');

const { niceDate, dateOnly } = require('./time')

class Executor
{
    scrappers;
    queue;


    constructor()
    {
        const jofogas = new Jofogas()
        const ingatlan = new Ingatlan()
        const auto = new Auto()

        this.scrappers = [jofogas]
        this.queue = Array()

        this.start()
        console.log(`[${niceDate()}] [Executor] Executor started |${this.scrappers.map(x => x.id()).join(' & ')}|`)
    }

    async start() 
    {
        while (true) 
        {
            await new Promise(resolve => setTimeout(resolve, 1000))
            await this.execute()
        }
    }

    getScrappers()
    {
        return this.scrappers.map(scrap => {
            return {id : scrap.id() , options : scrap.getOptions()}
        })
    }

    enqueue(owner, routine, page)
    {
        if(!Number.isNaN(page))
        {
            this.queue.push({owner, routine, page})
        }
    }

    async execute()
    {
        if(this.queue.length > 0)
        {
            const next = this.queue.shift()

            const engine = this.scrappers.find(scrapper => scrapper.id() == next.routine.engine)
            const result = await engine.scrapPage(next.routine, next.page)

            for(let found of result.items)
            {
                found.found = niceDate()
                await Item.create({
                    id: found.id,
                    sent: false,
                    owner: next.owner,
                    json: JSON.stringify(found)
                }, {
                    ignoreDuplicates: true
                })
            }
            
            this.enqueue(next.owner, next.routine, result.page)
            console.log(`[${niceDate()}] |${next.owner}| <${next.page}> /${engine.id()}->${next.routine.keywords}/ -> found ${result.items.length} `)
        }
    }
}

module.exports = Executor