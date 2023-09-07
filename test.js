const Jofogas = require('./srappers/jofogas')


async function main()
{
    const j = new Jofogas()
    console.log(await j.scrapPage({keywords: 'Iphone'}, 10))
}

main().then()