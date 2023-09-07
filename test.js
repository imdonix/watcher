const Jofogas = require('./srappers/jofogas')


async function main()
{
    const j = new Jofogas()
    console.log(await j.scrap({keywords: 'Iphone'}, 263))
}

main().then()