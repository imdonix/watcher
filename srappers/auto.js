const fetch = require('node-fetch')
const { parse } = require('node-html-parser')
const { cyrb53 } = require('../services/crypto')
const Scraper = require("../services/scraper")

const name = "hasznaltauto.hu"
const depth = 2;
const maxTimeOut = 2;

const CLIENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.72 Safari/537.36'
const URL = 'https://www.hasznaltauto.hu/talalatilista'
const DEPTH = 1
const TIMEOUT = 1250

function scrapHasznaltAuto(options, callback)
{
    const items = new Array()
    processPage(initSettings(options), items, 1)
    .then(() => callback(items))
}


function processPage(settings, items, page)
{
    return new Promise((res) => setTimeout(res, settings.timeout))
    .then(() => fetch(buildUrl(settings, page), { headers: { 'User-Agent' : CLIENT } }))
    .then((res) => res.textConverted())
    .then((res) => parsePage(res))
    .then((itemList) => populateItems(items, itemList))
    .then((itemList) => itemList.length > 0 && settings.depth > page ? processPage(settings, items, page + 1) : Promise.resolve())
}

function parsePage(plain)
{
    const domRoot = parse(plain)
    const itemList = new Array()
    for(const domItem of domRoot.querySelectorAll('.talalati-sor'))
    {
        try
        {
            let item = parseItem(domItem)
            itemList.push(item)
        } catch(err){console.log(err)}
    }   
    return itemList 
}

function parseItem(item)
{
    return {
        name :  item.querySelector('h3').firstChild.innerText,
        image: item.querySelector('.img-responsive')?.getAttribute('data-lazyurl'),
        url: item.querySelector('.img-responsive')?.parentNode?.getAttribute('href'),
        price: getPrice(item.querySelector('.vetelar')?.innerText),
        ad: item.querySelector('.label-hasznaltauto') != null
    }  
}

function getPrice(element)
{
    if(!element) return null

    let trimmed = element.replace(/\s/g,'')
    return Number(trimmed.substring(0, trimmed.length - 2));
}

function populateItems(items, newItems)
{
    items.push(...newItems)
    return Promise.resolve(newItems)
}

function buildUrl(settings, page)
{
    return `${URL}/${settings.key}/page${page}`
}

function initSettings(options)
{
    if(!options.key) throw new Error('Key is required for scraping');

    return {
        depth: options.depht || DEPTH,
        timeout: options.timeout || TIMEOUT,
        key: options.key
    }
}

class Auto extends Scraper
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
                key: routine.key
            }

            scrapHasznaltAuto(options, items => {
                items.forEach(item => {
                    item.id = cyrb53(`${item.url}-${name}`)
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
                id : "key",
                name : "Key",
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

    timeOut()
    {
        return Math.floor(Math.random() * Math.floor(maxTimeOut * 1000)) + 1000;
    }

}

module.exports = Auto