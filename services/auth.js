const { cyrb53 } = require('./crypto')
const { User } = require('./db')

module.exports = {
    auth: (req, res, next) =>
    {
        let pass = req.body.pass

        User.findAll()
        .then(users => {

            for (const user of users) 
            {
                if(pass === cyrb53(user.pass) || settings.DEV)
                {
                    res.locals.user = user.name
                    next()
                    return
                }
            }

            res.status(401).send()
        })
        .catch(err => res.status(500).send(`Database error: ${err}`))

    }
}