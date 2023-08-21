const { settings } = require('./cfg')
const { niceDate } = require('./time')

const Mail = require('../transports/mailer')
const Http = require('../transports/http')

class Telematic
{

    async init()
    {
        this.transports = [new Mail(), new Http()]

        //Filter transports which missing required settings
        this.active = this.transports.filter(transport => {
            const requirements = transport.required()
            for (const req of requirements) 
            {
                if (settings[req] == '')
                {
                    return false
                }
            }

            return true
        })

        if(this.active.length > 0)
        {
            const names = this.active.map(transport => transport.name())
            console.log(`[${niceDate()}] [Telematic] ${names.map(name => `'${name}'`).join(' & ')} is active`)
        }
        else
        {
            console.log(`[${niceDate()}] [Telematic] At least one transport must be configured to start the service`)
            process.exit(101)
        }
    }

    async send(title, user, html)
    {
        let tries = 0
        for (const transport of this.active) 
        {
            try 
            {
                await transport.send(title, user, html)
                tries++
            } 
            catch (error) 
            {
                console.warn(`[${niceDate()}] [Telematic] Transport '${transport.name()}' coudn't send update to user '${user}' (${err})`)
            }
        }

        return tries > 0
    }

}

module.exports = Telematic