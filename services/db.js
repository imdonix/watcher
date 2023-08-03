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
        type: DataTypes.STRING
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

const Item = sequelize.define('Item', {
    id: {
        type: DataTypes.STRING,
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
    json: {
        type: DataTypes.STRING,
        allowNull: false
    }
})

module.exports = { sequelize, User, Routine, Item }