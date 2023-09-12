const { cyrb53 } = require('./crypto')

const scrapJofogasPage = require('../srappers/jofogas.hu')
const scrapHasznaltautoPage = require('../srappers/hasznaltauto.hu')

function abs()
{
    throw new Error('Abstract function not implemented')
}

class Scraper
{
    id() { abs(); return '' }

    getOptions() { abs(); return {} }

    async scrapPage(routine, page) { abs(); return {items : Array(), page : 0} }
}

class JofogasHU extends Scraper
{
    id()
    {      
        return 'jofogas.hu'
    }

    async scrapPage(routine, page)
    {

        let settings = {
            keywords: routine.keywords,
            domain: routine.domain,
            minPrice : routine.minPrice,
            maxPrice : routine.maxPrice,
            enableCompany : routine.enableCompany,
            enablePost: routine.enablePost
        }

        const result = await scrapJofogasPage(settings, page)
        result.items.forEach(item => item.id = cyrb53(`${this.name}|${item.id}`)) // PostProcess item IDs

        return result
    }

    getOptions()
    {
        return [
            {
                id : "keywords",
                name : "Keywords",
                type : "text",
            },
            {
                id : "domain",
                name : "Platform URL",
                type : "url",
                default : `http://jofogas.hu/budapest`
            },
            {
                id : "minPrice",
                name : "Min price",
                type : "number" 
            },
            {
                id : "maxPrice",
                name : "Max price",
                type : "number" 
            },
            {
                id : "enableCompany",
                name : "Enable company ad",
                type : "checkbox" 
            },
            {
                id : "enablePost",
                name : "Enable post service",
                type : "checkbox" 
            }
        ]
    }

    getItemModel()
    {
        return [
            "id", 
            "name", 
            "price", 
            "url", 
            "company", 
            "post", 
            "found"
        ]
    }

}

class HasznaltautoHU extends Scraper
{
    id()
    {
        return 'hasznaltauto.hu'
    }

    async scrapPage(routine, page)
    {
        let settings = {
            key: routine.key,
        }

        const result = await scrapHasznaltautoPage(settings, page)
        result.items.forEach(item => item.id = cyrb53(`${this.name}|${item.id}`)) // PostProcess item IDs

        return result
    }

    getOptions()
    {
        return [
            {
                id : "keywords",
                name : "Tag (name in the list)",
                type : "text" 
            },
            {
                id : "key",
                name : "Do a manual search and insert the Key here www.hasznaltauto.hu/talalatilista/<KEY>",
                type : "text" 
            }
        ]
    }

    getItemModel()
    {
        return [
            "name",
            "image",
            "url",
            "price",
            "ad"
        ]
    }

}

module.exports = [HasznaltautoHU, JofogasHU]