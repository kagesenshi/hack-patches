/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */

/*
 * Pidgin GnomeShell Integration.
 *
 * Credits to the author of Gajim extension as this extension code was modified
 * from it.
 *
 */

const DBus = imports.dbus;
const GLib = imports.gi.GLib;
const Lang = imports.lang;
const St = imports.gi.St;
const Main = imports.ui.main;
const MessageTray = imports.ui.messageTray;
const Shell = imports.gi.Shell;
const TelepathyClient = imports.ui.telepathyClient;

const Gettext = imports.gettext.domain('gnome-shell-extensions');
const _ = Gettext.gettext;

function wrappedText(text, sender, timestamp, direction) {
    return {
        text: text,
        sender: sender,
        timestamp: timestamp,
        direction: direction
    };
}


function PidginNotification(source) {
    this._init(source);
}

function _fixText(text) {
    // remove all tags
    let _text = text.replace(/<\/?[^>]+(>|$)/g, "");
    return _text;
}

PidginNotification.prototype = {
    __proto__: TelepathyClient.Notification.prototype,

    appendMessage: function(message, noTimestamp, styles) {
        let messageBody = _fixText(message.text);
        styles = styles || [];
        styles.push(message.direction);
        this.update(this.source.title, messageBody, { customContent: true, bannerMarkup: true });
        this._append(messageBody, styles, message.timestamp, noTimestamp);
    }
}

function Source(client, account, author, initialMessage, conversation, flag) {
    this._init(client, account, author, initialMessage, conversation, flag);
}

Source.prototype = {
    __proto__: MessageTray.Source.prototype,

    _init: function(client, account, author, initialMessage, conversation, flag) {

        let proxy = client.proxy();
        this._client = client;
        this._author = author;
        this._account = account;
        this._conversation = conversation;
        this._initialMessage = initialMessage;
        this._initialFlag = flag;
        this._iconUri = null;
        this._presence = 'online';
        this.isChat = true;
        this._notification = new PidginNotification(this);
        this._notification.setUrgency(MessageTray.Urgency.HIGH);


        proxy.PurpleFindBuddyRemote(account, author, Lang.bind(this, this._async_set_author_buddy))
    },

    _async_set_author_buddy: function (author_buddy) {
        let proxy = this._client.proxy();
        this._author_buddy = author_buddy;
        proxy.PurpleConvImRemote(this._conversation, Lang.bind(this, this._async_set_conversation_im));
    },

    _async_set_conversation_im: function (conversation_im) {
        let proxy = this._client.proxy();
        this._conversation_im = conversation_im;
        proxy.PurpleConversationGetTitleRemote(this._conversation, Lang.bind(this, this._async_set_title));
    },

    _async_set_title: function (title) {
        let proxy = this._client.proxy();
        this.title = _fixText(title);
        proxy.PurpleBuddyGetIconRemote(this._author_buddy, Lang.bind(this, this._async_get_icon));
    },

    _async_get_icon: function (iconobj) {
        let proxy = this._client.proxy();
        if (iconobj) {
            proxy.PurpleBuddyIconGetFullPathRemote(iconobj, Lang.bind(this, this._async_set_icon));
        } else {
            this._start();
        }
    },

    _async_set_icon: function (iconpath) {
        this._iconUri = 'file://' + iconpath;
        this._start();
    },

    _start: function () {

        let proxy = this._client.proxy();
        MessageTray.Source.prototype._init.call(this, this.title);

        this._setSummaryIcon(this.createNotificationIcon());

        Main.messageTray.add(this);

        let direction = null;
        if (this._initialFlag == 1) {
            direction = TelepathyClient.NotificationDirection.SENT;
        } else if (this._initialFlag == 2) {
            direction = TelepathyClient.NotificationDirection.RECEIVED;
        }

        let message = wrappedText(this._initialMessage, this._author, null, direction);
        this._notification.appendMessage(message, true);

        this._buddyStatusChangeId = proxy.connect('BuddyStatusChanged', Lang.bind(this, this._onBuddyStatusChange));
        this._buddySignedOffId = proxy.connect('BuddySignedOff', Lang.bind(this, this._onBuddySignedOff));
        this._buddySignedOnId = proxy.connect('BuddySignedOn', Lang.bind(this, this._onBuddySignedOn));
        this._deleteConversationId = proxy.connect('DeletingConversation', Lang.bind(this, this._onDeleteConversation));
        this._messageDisplayedId = proxy.connect('DisplayedImMsg', Lang.bind(this, this._onDisplayedImMessage));

        this.notify(this._notification);
    },

    destroy: function () {
        let proxy = this._client.proxy();
        proxy.disconnect(this._buddyStatusChangeId);
        proxy.disconnect(this._buddySignedOffId);
        proxy.disconnect(this._buddySignedOnId);
        proxy.disconnect(this._deleteConversationId);
        proxy.disconnect(this._messageSentId);
        proxy.disconnect(this._messageReceivedId);
        MessageTray.Source.prototype.destroy.call(this);
    },
    

    createNotificationIcon: function() {
        let iconBox = new St.Bin({ style_class: 'avatar-box' });
        iconBox._size = this.ICON_SIZE;

        if (!this._iconUri) {
            iconBox.child = new St.Icon({ icon_name: 'avatar-default',
                                          icon_type: St.IconType.FULLCOLOR,
                                          icon_size: iconBox._size });
        } else {
            let textureCache = St.TextureCache.get_default();
            iconBox.child = textureCache.load_uri_async(this._iconUri, iconBox._size, iconBox._size);
        }
        return iconBox;
    },

    open: function(notification) {
        let app = Shell.AppSystem.get_default().get_app('pidgin.desktop');
        app.activate_window(null, global.get_current_time());
    },

    notify: function () {
        MessageTray.Source.prototype.notify.call(this, this._notification);
    },

    respond: function(text) {
        let proxy = this._client.proxy();
        let _text = GLib.markup_escape_text(text, -1);
        proxy.PurpleConvImSendRemote(this._conversation_im, _text);
    },

    _onBuddyStatusChange: function (emitter, buddy, old_status_id, new_status_id) {
        if (!this.title) return;

        let self = this;

        let proxy = this._client.proxy();

        if (buddy != this._author_buddy) return;

        let presenceInfo = {};

        let notify_presence = function () {

            let presence = presenceInfo.presence;
            let message = presenceInfo.message;
            if (self._presence == presence) return;
    
            let title = self.title;
            let presenceMessage, shouldNotify;
            if (presence == "away") {
                presenceMessage = _("%s is away.").format(title);
            } else if (presence == "available") {
                presenceMessage = _("%s is available.").format(title);
            } else if (presence == "dnd") {
                presenceMessage = _("%s is busy.").format(title);
            } else {
                return;
            }
    
            self._presence = presence;
    
            if (message)
                presenceMessage += ' <i>(' + _fixText(message) + ')</i>';
    
            self._notification.appendPresence(presenceMessage, false);
        };
 
        let set_presence_message = function (message) {
            presenceInfo.message = message;
            notify_presence();
        };
        let set_presence = function (presence) {
            presenceInfo.presence = presence;
            proxy.PurpleStatusGetAttrStringRemote(new_status_id, 'message', set_presence_message);
        };

        proxy.PurpleStatusGetIdRemote(new_status_id, set_presence);

    },

    _onBuddySignedOff: function(emitter, buddy) {
        if (buddy != this._author_buddy) return;

        let shouldNotify = this._presence != 'offline';
        let presenceMessage = _("%s is offline.").format(this.title);
        this._notification.appendPresence(presenceMessage, shouldNotify);
        this._presence = 'offline';
        if (shouldNotify) 
            this.notify(this._notification);
    },

    _onBuddySignedOn: function(emitter, buddy) {
        if (buddy != this._author_buddy) return;

        let shouldNotify = this._presence == 'offline';
        let presenceMessage = _("%s is online.").format(this.title);
        this._notification.appendPresence(presenceMessage, shouldNotify);
        this._presence = 'online';
        if (shouldNotify) 
            this.notify(this._notification);
    },

    _onDeleteConversation: function(emitter, conversation) {
        if (conversation != this._conversation) return;
        this.destroy();
    },


    _onDisplayedImMessage: function(emitter, account, author, text, conversation, flag) {

        if (text && (this._conversation == conversation)) {
            let direction = null;
            if (flag == 1) {
                direction = TelepathyClient.NotificationDirection.SENT;
            } else if (flag == 2) {
                direction = TelepathyClient.NotificationDirection.RECEIVED;
            }
            if (direction != null) {
                let message = wrappedText(text, author, null, direction);
                this._notification.appendMessage(message, true);
                this.notify(this._notification);
            }
        }

    }

}

const PidginIface = {
    name: 'im.pidgin.purple.PurpleInterface',
    properties: [],
    methods: [
        {name: 'PurpleGetIms', inSignature: '', outSignature: 'ai'},
        {name: 'PurpleAccountsGetAllActive', inSignature: '', outSignature: 'ai'},
        {name: 'PurpleConversationGetType', inSignature: 'i', outSignature: 'u'},
        {name: 'PurpleFindBuddies', inSignature: 'is', outSignature: 'ai'},
        {name: 'PurpleFindBuddy', inSignature: 'is', outSignature: 'i'},
        {name: 'PurpleAccountGetAlias', inSignature: 'i', outSignature: 's'},
        {name: 'PurpleAccountGetNameForDisplay', inSignature: 'i', outSignature: 's'},
        {name: 'PurpleBuddyGetAlias', inSignature: 'i', outSignature: 's'},
        {name: 'PurpleBuddyGetName', inSignature: 'i', outSignature: 's'},
        {name: 'PurpleStatusGetId', inSignature: 'i', outSignature: 's'},
        {name: 'PurpleStatusGetAttrString', inSignature: 'is', outSignature: 's'},
        {name: 'PurpleBuddyIconGetFullPath', inSignature: 'i', outSignature: 's'},
        {name: 'PurpleBuddyGetIcon', inSignature: 'i', outSignature: 'i'},
        {name: 'PurpleConvImSend', inSignature: 'is', outSignature: ''},
        {name: 'PurpleConvIm', inSignature: 'i', outSignature: 'i'},
        {name: 'PurpleConvImGetIcon', inSignature: 'i', outSignature: 'i'},
        {name: 'PurpleConversationGetName', inSignature: 'i', outSignature: 's'},
        {name: 'PurpleConversationGetAccount', inSignature: 'i', outSignature: 's'},
        {name: 'PurpleConversationGetMessageHistory', inSignature: 'i', outSignature: 'ai'},
        {name: 'PurpleConversationMessageGetMessage', inSignature: 'i', outSignature: 's'},
        {name: 'PurpleConversationGetTitle', inSignature: 'i', outSignature: 's'},
    ],
    signals: [
        {name: 'ReceivedImMsg', inSignature: 'issiu'},
        {name: 'DisplayedImMsg', inSignature: 'issiu'},
        {name: 'SentImMsg', inSignature: 'iss'},
        {name: 'BuddyStatusChanged', inSignature: 'iii'}, // ????
        {name: 'BuddySignedOff', inSignature: 'i'},
        {name: 'BuddySignedOn', inSignature: 'i'},
        {name: 'DeletingConversation', inSignature: 'i'},
        {name: 'ConversationCreated', inSignature: 'i'}
    ]
};

let Pidgin = DBus.makeProxyClass(PidginIface);

function patchSynchronousMethods(obj, iface) {
    if ('methods' in iface) {
        let methods = iface.methods;

        for (let i = 0; i < methods.length; ++i) {
            let method = methods[i];

            if (!('name' in method))
                throw new Error("Method definition must have a name");

            if (!('outSignature' in method))
                method.outSignature = "a{sv}";

            if (!("inSignature" in method))
                method.inSignature = "a{sv}";

            if (!("timeout" in method))
                method.timeout = -1;

            let name = method.name + 'Sync';
            obj[name] = function () {
                let arg_array = Array.prototype.slice.call(arguments);
                return obj._dbusBus.call(
                    obj._dbusBusName,
                    obj._dbusPath,
                    obj._dbusInterface,
                    method.name,
                    method.outSignature,
                    method.inSignature,
                    false,
                    1000,
                    arg_array || []
                );
            }
        }
    }
    return obj;
}

function PidginClient() {
    this._init();
}

PidginClient.prototype = {
    _init: function() {
        this._sources = {};
        this._proxy = new Pidgin(DBus.session, 'im.pidgin.purple.PurpleService', '/im/pidgin/purple/PurpleObject');
        patchSynchronousMethods(this._proxy, PidginIface);
        this._proxy.connect('DisplayedImMsg', Lang.bind(this, this._messageDisplayed));
    },

    proxy: function () {
        return this._proxy;
    },

    _messageDisplayed: function(emitter, account, author, message, conversation, flag) {

        // only trigger on message received/message sent
        if (flag != 1 && flag != 2) return;

        if (conversation) {
            let source = this._sources[conversation];
            if (!source) {
                source = new Source(this, account, author, message, conversation, flag);
                source.connect('destroy', Lang.bind(this, 
                    function() {
                        delete this._sources[conversation];
                    }
                ));
            }
            this._sources[conversation] = source;
        }
    }
}


function main(metadata) {
    imports.gettext.bindtextdomain('gnome-shell-extensions', metadata.localedir);
    let client = new PidginClient();
}
