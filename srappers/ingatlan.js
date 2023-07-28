const fetch = require('node-fetch')
const { parse } = require('node-html-parser')
const { cyrb53 } = require('../services/crypto')
const Scraper = require("../services/scraper")

const name = "ingatlan.com"
const depth = 3;
const maxTimeOut = 2;

const DEPTH = 5
const TIMEOUT = 350
const URL = 'https://ingatlan.com'
const LIST = '/szukites'
const SEARCH = 'elado+lakas'

function scrapIngatlan(options, callback)
{
    const items = new Array()
    processPage(initSettings(options), items, 1)
    .then(() => callback(items))
}

function processPage(settings, items, page)
{
    return new Promise((res) => setTimeout(res, settings.timeout))
    .then(() => fetch(buildUrl(settings, page)))
    .then((res) => res.textConverted())
    .then((res) => parsePage(res))
    .then((itemList) => populateItems(items, itemList))
    .then((itemList) => itemList.length > 0 && settings.depth > page ? processPage(settings, items, page + 1) : Promise.resolve())
}

function parsePage(plain)
{
    const domRoot = parse(plain)
    const itemList = new Array()
    for(const domItem of domRoot.querySelectorAll('.listing'))
    {
        try
        {
            let item = parseItem(domItem)
            itemList.push(item)
        } catch(err){}
    }   
    return itemList 
}

function parseItem(item)
{
    return {
        image: item.querySelector('.listing__image')?.getAttribute('src'),
        url: `${URL}${item.querySelector('.listing__link')?.getAttribute('href')}`,
        where: item.querySelector('.listing__address')?.innerHTML.trim(),
        price: getPrice(item.querySelector('.price')?.innerHTML),
        area: Number(item.querySelector('.listing__data--area-size')?.innerHTML.trim().split(' ')[0]),
    }  
}

function getPrice(element)
{
    if(!element) return null

    let price = Number(element.trim().split(' ')[0])
    let multiplier = element.trim().split(' ')[1] === 'M';
    return Math.floor(price * (multiplier ? 1000000 : 1000))
}

function populateItems(items, newItems)
{
    items.push(...newItems)
    return Promise.resolve(newItems)
}

function buildUrl(settings, page)
{
    let final = `${URL}${LIST}/${settings.search}`
    return `${final}?${new URLSearchParams({'page' : page})}`
}

function initSettings(options)
{
    return {
        depth: options.depht || DEPTH,
        timeout: options.timeout || TIMEOUT,
        search: options.search || SEARCH
    }
}

class Ingatlan extends Scraper
{
    constructor()
    {
        super(name)
        this.id = this.uniqueID(name)
    }

    scrap(routine)
    {
        return new Promise((res, _) => 
        {
            let options = {
                depth: depth,                     
                timeout: this.timeOut(),
                search: routine.search
            }

            scrapIngatlan(options, items => {
                items.forEach(item => {
                    item.id = cyrb53(`${item.url}-${name}`)
                    item.name = item.where

                })
                res(items)
            })
        })
    }

    getOptions()
    {
        return [
            {
                id : "keywords",
                name : "Tag (only for the user)",
                type : "text" 
            },
            {
                id : "search",
                name : "Search params form ingatlan.com",
                type : "text" 
            }
        ]
    }

    getItemModel()
    {
        return [
            "id",
            "image",
            "url",
            "where",
            "price",
            "area"
        ]
    }

    timeOut()
    {
        return Math.floor(Math.random() * Math.floor(maxTimeOut * 1000)) + 1000;
    }

}

module.exports = Ingatlan