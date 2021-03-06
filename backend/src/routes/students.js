const passport = require('passport');
const express = require('express');
const router = express.Router();
const auth = require('../components/auth');
const { getStudentById } = require('../components/penRequests');


router.get('/:id', passport.authenticate('jwt', {session: false}, undefined), auth.isValidAdminToken, getStudentById);

module.exports = router;
