var minimist = require('minimist')

const settings = {
    port : '80',
    clean : false, // Clean database
    scrap : 5, // How reguar the scrapping should happen in minutes
    notify : 8, // When to sent out the the daily mail => 8 means 8:00

    
    mail_host : '',
    mail_port : '',
    mail_user : '',
    mail_pass : '',

    http_url : 'http://localhost:#/dev',
}

function initSettings(argv)
{
    const user = minimist(process.argv.slice(2))

    if(user.hasOwnProperty('h'))
    {
        for (const key of Object.keys(settings)) 
        {
            console.log(`--${key} <value>`)
        }

        process.exit(0)
    }

    for (const key of Object.keys(user)) 
    {
        settings[key] = user[key]
    }

    //If no url provided replace the X with the port
    if (! ('http_url' in user))
    {
        settings['http_url'] = settings['http_url'].replace('#', settings['port'])
    }

    return Promise.resolve()
}


module.exports = { initSettings, settings }

