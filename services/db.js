const { Sequelize, DataTypes } = require('sequelize');

const sequelize = new Sequelize('sqlite:data/watcher', {
    logging: false
});

const User = sequelize.define('User', {
    name: {
        type: DataTypes.STRING,
        allowNull: false,
        primaryKey: true
    },
    pass: {
        type: DataTypes.STRING,
        allowNull: false,
    }
})

const Routine = sequelize.define('Routine', {
    owner: {
        type: DataTypes.STRING,
        allowNull: false
    },
    json: {
        type: DataTypes.STRING,
        allowNull: false
    }
})



const itemFrame = {
    id: {
        type: DataTypes.NUMBER,
        allowNull: false,
        primaryKey: true
    },

    owner: {
        type: DataTypes.STRING,
        allowNull: false,
        primaryKey: true
    },

    sent: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
    },

    found: {
        type: DataTypes.STRING,
        allowNull: false,
    }
}

const scrappers = require('./scraper').map(Class => (new Class()))
for (const scrapper of scrappers) 
{
    const model = scrapper.getItemModel()
    for (const elem of Object.keys(model)) 
    {
        if (itemFrame[elem])
        {
            if(itemFrame[elem].type != model[elem])
            {
                throw new Error(`ERROR: There is a type mismatch in item models on '${elem}' [${scrapper.id()}]`)
            }
        }
        else
        {
            itemFrame[elem] = {
                type : model[elem],
                allowNull: true
            }
        }
        
    }
}

const Item = sequelize.define('Item', itemFrame)

module.exports = { sequelize, User, Routine, Item }
