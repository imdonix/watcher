const { DataTypes } = require('sequelize');
const { cyrb53 } = require('./crypto')

const scrapJofogasPage = require('../srappers/jofogas.hu')
const scrapHasznaltautoPage = require('../srappers/hasznaltauto.hu')

function abs()
{
    throw new Error('Abstract function not implemented')
}

class Scraper
{
    id() { abs() }

    getOptions() { abs() }

    getItemModel() { abs() }

    async wrapScrapPage(routine, page) { abs() }


    async scrapPage(routine, page) 
    {
        const result = await this.wrapScrapPage(routine, page)
        result.items.forEach(item => item.id = cyrb53(`${this.name}|${item.id}`)) // PostProcess item IDs
        return result
    }
}

class JofogasHU extends Scraper
{
    id()
    {      
        return 'jofogas.hu'
    }

    async wrapScrapPage(routine, page)
    {
        let settings = {
            keywords: routine.keywords,
            domain: routine.domain,
            minPrice : routine.minPrice,
            maxPrice : routine.maxPrice,
            enableCompany : routine.enableCompany,
            enablePost: routine.enablePost
        }

        return await scrapJofogasPage(settings, page)
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
        return {
            id : DataTypes.NUMBER,
            name : DataTypes.STRING,
            price : DataTypes.NUMBER,
            image : DataTypes.STRING,
            url : DataTypes.STRING,
            company : DataTypes.BOOLEAN,
            post : DataTypes.BOOLEAN,
        }
    }

}

class HasznaltautoHU extends Scraper
{
    id()
    {
        return 'hasznaltauto.hu'
    }

    async wrapScrapPage(routine, page)
    {
        let settings = {
            key: routine.key,
        }

        return await scrapHasznaltautoPage(settings, page)
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
        return {
            id : DataTypes.NUMBER,
            name : DataTypes.STRING,
            image : DataTypes.STRING,
            url : DataTypes.STRING,
            price : DataTypes.NUMBER,
            ad : DataTypes.BOOLEAN,
        }
    }

}

module.exports = [HasznaltautoHU, JofogasHU]