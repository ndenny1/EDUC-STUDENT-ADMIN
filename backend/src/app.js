'use strict';

const config = require('./config/index');
const dotenv = require('dotenv');
const log = require('npmlog');
const morgan = require('morgan');
const session = require('express-session');
const express = require('express');
const passport = require('passport');
const helmet = require('helmet');
const cors = require('cors');
const utils = require('./components/utils');
const auth = require('./components/auth');

dotenv.config();

const JWTStrategy = require('passport-jwt').Strategy;
const ExtractJwt = require('passport-jwt').ExtractJwt;
const OidcStrategy = require('passport-openidconnect-kc-idp').Strategy;

const apiRouter = express.Router();
const authRouter = require('./routes/auth');
const penRequestRouter = require('./routes/penRequest');
const emailsRouter = require('./routes/emails');

//initialize app
const app = express();

//sets security measures (headers, etc)
app.use(cors());
app.use(helmet());
app.use(helmet.noCache());

//tells the app to use json as means of transporting data
app.use(express.json());
app.use(express.urlencoded({
  extended: false
}));

app.use(morgan(config.get('server:morganFormat')));

//sets cookies for security purposes (prevent cookie access, allow secure connections only, etc)
var expiryDate = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
app.use(session({
  secret: config.get('oidc:clientSecret'),
  resave: true,
  saveUninitialized: true,
  httpOnly: true,
  secure: true,
  expires: expiryDate
}));

//initialize routing and session. Cookies are now only reachable via requests (not js)
app.use(passport.initialize());
app.use(passport.session());

//configure logging
log.level = config.get('server:logLevel');
log.addLevel('debug', 1500, {
  fg: 'cyan'
});

//initialize our authentication strategy
utils.getOidcDiscovery().then(discovery => {
  //OIDC Strategy is used for authorization
  passport.use('oidc', new OidcStrategy({
    issuer: discovery.issuer,
    authorizationURL: discovery.authorization_endpoint,
    tokenURL: discovery.token_endpoint,
    userInfoURL: discovery.userinfo_endpoint,
    clientID: config.get('oidc:clientId'),
    clientSecret: config.get('oidc:clientSecret'),
    callbackURL: config.get('server:frontend') + '/api/auth/callback',
    scope: discovery.scopes_supported,
    kc_idp_hint: 'keycloak_bcdevexchange'
  }, (_issuer, _sub, profile, accessToken, refreshToken, done) => {
    if ((typeof (accessToken) === 'undefined') || (accessToken === null) ||
      (typeof (refreshToken) === 'undefined') || (refreshToken === null)) {
      return done('No access token', null);
    }
    //Generate token for frontend validation
    var token = auth.generateUiToken();
    console.log('PUBLIC----->' + config.get('tokenGenerate:publicKey'));
    console.log('PRIVATE----->' + config.get('tokenGenerate:publicKey'));
    //set access and refresh tokens
    profile.jwtFrontend = token;
    profile.jwt = accessToken;
    profile.refreshToken = refreshToken;
    console.log('FRONTEND----->' + profile.jwtFrontend);
    console.log('JWT----->' + profile.jwt);
    console.log('REFRESH----->' + profile.refreshToken);

    return done(null, profile);
  }));
  //JWT strategy is used for authorization
  passport.use('jwt', new JWTStrategy({
    algorithms: ['RS256'],
    // Keycloak 7.3.0 no longer automatically supplies matching client_id audience.
    // If audience checking is needed, check the following SO to update Keycloak first.
    // Ref: https://stackoverflow.com/a/53627747
    //audience: config.get('tokenGenerate:audience'),
    audience: config.get('server:frontend'),
    issuer: config.get('tokenGenerate:issuer'),
    jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
    secretOrKey: config.get('tokenGenerate:publicKey')
  }, (jwtPayload, done) => {
    console.log('HERE----->' + config.get('tokenGenerate:publicKey'));
    console.log('HERE----->' + config.get('tokenGenerate:issuer'));
    if ((typeof (jwtPayload) === 'undefined') || (jwtPayload === null)) {
      console.log('fail');
      return done('No JWT token', null);
    }
    console.log('email------------->' + jwtPayload.email);
    console.log('family_name------------->' + jwtPayload.family_name);
    console.log('given_name------------->' + jwtPayload.given_name);
    console.log('name------------->' + jwtPayload.name);
    console.log('preferred_username------------->' + jwtPayload.preferred_username);
    console.log('realm_role------------->' + jwtPayload.realm_role);
    console.log('jwtPayload------------->' + jwtPayload);
    done(null, {
      jwt: jwtPayload,
      realmRole: jwtPayload.realm_role
    });
  }));
});
//functions for serializing/deserializing users
passport.serializeUser((user, next) => next(null, user));
passport.deserializeUser((obj, next) => next(null, obj));

// GetOK Base API Directory
apiRouter.get('/', (_req, res) => {
  res.status(200).json({
    endpoints: [
      '/api/auth',
      '/api/penRequest',
      '/api/emails'
    ],
    versions: [
      1
    ]
  });
});

//set up routing to auth and main API
app.use(/(\/api)?/, apiRouter);

apiRouter.use('/auth', authRouter);
apiRouter.use('/penRequest', penRequestRouter);
apiRouter.use('/emails', emailsRouter);

//Handle 500 error
app.use((err, _req, res, next) => {
  log.error(err.stack);
  res.status(500).json({
    status: 500,
    message: 'Internal Server Error: ' + err.stack.split('\n', 1)[0]
  });
  next();
});

// Handle 404 error
app.use((_req, res) => {
  console.log("In 404");
  res.status(404).json({
    status: 404,
    message: 'Page Not Found'
  });
});

// Prevent unhandled errors from crashing application
process.on('unhandledRejection', err => {
  log.error(err.stack);
});

module.exports = app;
