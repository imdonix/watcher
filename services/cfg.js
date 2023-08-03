var minimist = require('minimist')

const settings = {
    port : '80',
    dev : false,
    scrap : 5, // How reguar the scrapping should happen in minutes
    notify : 8, // When to sent out the the daily mail => 8 means 8:00
    mail_user : '',
    mail_pass : '', 
}

function initSettings(argv)
{
    const user = minimist(process.argv.slice(2))
    console.log(user)

    for (const key of Object.keys(user)) 
    {
        settings[key] = user[key]
    }

    console.log(settings)

    return Promise.resolve()
}


module.exports = { initSettings, settings }

