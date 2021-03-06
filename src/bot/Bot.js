const _ = require('lodash');
const SlackBot = require('slackbots');
const utils = require('../utils/utils.js');
const templates = require('./templates/templates.json');


class BitcoinBot extends SlackBot {
    /**
     * config.name determines which template file is loaded.
     * @param {object} config - name, token
     * @constructor
     */
    constructor(config) {
        super(config);
        this.config = { as_user: true };
        this.isAddingDialog = false;
        this.namePattern = new RegExp(this.name, 'i');
        this.template = templates[this.name] ? templates[this.name] : templates.default;
        this.on('message', this.handleMessage);
        console.log(this.name, 'initialized...');
    }

    /**
     * Listener for slack events.
     * @param {object} slackEvent
     * @return {promise}
     */
    handleMessage(slackEvent) {
        if (slackEvent.type !== 'message' || !slackEvent.text || !this.botCalled(slackEvent.text)) {
            return;
        }
        const channel = this._getChannel(slackEvent.channel);

        if (this.isAddingDialog) {
            return this.handleAddTemplate(slackEvent, channel);
        }

        if (slackEvent.text.match(/add/i)) {
            return this.handleAddTemplatePrompt(channel);
        }

        if (slackEvent.text.match(/today/i)) {
            if (slackEvent.text.match(/eth/i)) {
                return this.eth24HourPerformanceResponse(channel);
            }
            const altCoin = utils.namesValidCoin(slackEvent.text);
            if (altCoin) {
                if (altCoin === 'golem') {
                    return this.alt24HourPerformanceResponse('golem-network-tokens', channel);
                }
                return this.alt24HourPerformanceResponse(altCoin, channel);
            }
            return this.btc24HourPerformanceResponse(channel);
        }

        if (slackEvent.text.match(/eth/i)) {
            return this.ethPriceResponse(channel);
        }
        const altCoin = utils.namesValidCoin(slackEvent.text);
        if (altCoin) {
            if (altCoin === 'golem') {
                return this.altCurrentPriceResponse('golem-network-tokens', channel);
            }
            return this.altCurrentPriceResponse(altCoin, channel);
        }

        if (slackEvent.text.match(/news/i)) {
            return utils.fetchNewsFromCoindesk()
                .then((news) => {
                    return this.newsResponse(news, channel);
                })
                .catch(console.error);
        }
        return this.defaultResponse(channel);
    }

    newsResponse(newsArray, channel) {
        let message = '*The latest crypto news:* \n';
        _.each(newsArray, (news, index) => {
            message += `${index + 1}. *${news.title}* \n${news.link}\n`;
        });
        return this._postMessage(message, channel);
    }

    altCurrentPriceResponse(coin, channel) {
        return utils.fetchFromCoinMarketCap(coin)
            .then((response) => {
                const data = {
                    name: response.data[0].name,
                    price: utils.formatPrice(response.data[0].price_usd)
                };
                const template = utils.getRandom(this.template.altcoin.current_price);
                const compileMessage = _.template(template);
                const message = compileMessage(data);
                return this._postMessage(message, channel);
            })
            .catch(console.error);
    }

    alt24HourPerformanceResponse(coin, channel) {
        return utils.fetchFromCoinMarketCap(coin)
            .then((response) => {
                const data = {
                    name: response.data[0].name,
                    percentChange: response.data[0].percent_change_24h,
                    currentPrice: utils.formatPrice(response.data[0].price_usd)
                };
                const negativePercentage = data.percentChange[0] === '-';
                const priceChange = negativePercentage ? 'decrease' : 'increase';
                const template = utils.getRandom(this.template.altcoin.price_change[priceChange]);
                const compileMessage = _.template(template);
                const message = compileMessage(data);
                return this._postMessage(message, channel);
            })
            .catch(console.error);
    }

    _currentPriceResponse(response, channel, currency) {
        const price = {
            price: utils.formatPrice(response.data.last)
        };
        const template = utils.getRandom(this.template[currency].current_price);
        const compileMessage = _.template(template);
        const message = compileMessage(price);
        return this._postMessage(message, channel);
    }

    /**
     * defaultResponse
     * @param  {object} channel
     * @return {promise}
     */
    defaultResponse(channel) {
        return utils.getBitcoinPriceData()
            .then((response) => {
                return this._currentPriceResponse(response, channel, 'bitcoin');
            })
            .catch(console.error);
    }

    ethPriceResponse(channel) {
        utils.getEtherPriceData()
            .then((response) => {
                return this._currentPriceResponse(response, channel, 'ether');
            })
            .catch(console.error);
    }

    /**
     * btc24HourPerformanceResponse
     * @param  {object} channel
     * @return {promise}
     */
    btc24HourPerformanceResponse(channel) {
        return utils.getBitcoinPriceData()
            .then((response) => {
                return this.compile24HrMessage(response.data, 'bitcoin');
            })
            .then(message => this._postMessage(message, channel))
            .catch(console.error);
    }

    /**
     * eth24HourPerformanceResponse
     * @param  {type} channel
     * @return {promise}
     */
    eth24HourPerformanceResponse(channel) {
        return utils.getEtherPriceData()
            .then((response) => {
                return this.compile24HrMessage(response.data, 'ether');
            })
            .then(message => this._postMessage(message, channel))
            .catch(console.error);
    }

    /**
     * handleAddTemplatePrompt
     * @param  {object} channel
     * @return {promise}
     */
    handleAddTemplatePrompt(channel) {
        this.isAddingDialog = true;
        return this._postMessage(templates.default.add.prompt, channel)
            .then(() => {
                return this._postMessage(templates.default.add.example, channel);
            })
            .then(() => {
                return this._postMessage(templates.default.add.labelsHeader, channel);
            })
            .then(() => {
                return this._postMessage(templates.default.add.labels, channel);
            });
    }

    /**
     * handleAddTemplate
     * @param  {object} slackEvent
     * @param  {object} channel
     * @return {promise}
     */
    handleAddTemplate(slackEvent, channel) {
        const template = utils.parseMessageForTemplate(slackEvent.text);
        const label = utils.parseMessageForLabel(slackEvent.text);

        if (!template || !label) {
            this.isAddingDialog = false;
            return this._postMessage(templates.default.add.error, channel);
        }

        const templatesArray = utils.getTemplatesAtPath(this.template, label);

        if (!templatesArray) {
            this.isAddingDialog = false;
            return this._postMessage(templates.default.add.error, channel);
        }

        templatesArray.push(template);
        this.isAddingDialog = false;
        return this._postMessage(templates.default.add.success, channel);
    }

    /**
     * Posts message to appropriate slack channel.
     * @param {string} message
     * @param {object} channelData
     * @returns {Promise}
     */
    _postMessage(message, channelData) {
        const { channelType, channel } = channelData;
        if (!channelType || !channel) {
            return;
        }
        if (channelType === 'public') {
            return this.postMessageToChannel(channel, message, this.config)
                .fail(console.error);
        }
        return this.postMessageToGroup(channel, message, this.config)
            .fail(console.error);
    }

    /**
     * compile24HrMessage
     * @param  {object} priceData
     * @param  {string} currency
     * @return {string}
     */
    compile24HrMessage(priceData, currency = 'bitcoin') {
        const {
            openPrice,
            currentPrice,
            percentChange
        } = utils.package24HrData(priceData);
        let selectedCurrency;
        let template;
        if (currency !== 'bitcoin' && currency !== 'ether') {
            selectedCurrency = 'bitcoin';
        } else {
            selectedCurrency = currency;
        }
        if (_.toNumber(openPrice) < _.toNumber(currentPrice)) {
            template = utils.getRandom(this.template[selectedCurrency].price_change.increase);
        } else {
            template = utils.getRandom(this.template[selectedCurrency].price_change.decrease);
        }
        const compileMessage = _.template(template);
        return compileMessage({ percentChange, openPrice, currentPrice });
    }

    /**
     * returns a boolean for whether the text contains the name of the bot.
     * @param  {string} text
     * @return {boolean}
     */
    botCalled(text) {
        return text.match(this.namePattern) !== null;
    }

    /**
     * returns an object with the channel name and type
     * @param  {string} id
     * @return {object}
     */
    _getChannel(id) {
        const channel = _.find(this.channels, (slackChannel) => {
            return slackChannel.id === id;
        });

        if (channel) {
            return {
                channelType: 'public',
                channel: channel.name
            };
        }

        const group = _.find(this.groups, (slackGroup) => {
            return slackGroup.id === id;
        });

        if (group) {
            return {
                channelType: 'private',
                channel: group.name
            };
        }
    }
}

module.exports = BitcoinBot;
