/**
 * Authentication controller
 * Springload - 2014
 *
 **/

var async = require('async');
var crypto = require('crypto');
var nunjucks  = require('nunjucks');



/**
 * GET /login
 * @param req
 * @param res
 */
exports.getLogin = function (req, res, next) {
    res.render("auth/login.j2");
};


exports.login = function(req, res, next) {

    if (req.session.returnTo) {
        res.redirect(req.session.returnTo);
        delete req.session.returnTo;
        return;
    }

    res.redirect("/");
};

/**
 *
 * The default function checks four possible token locations:
 * _csrf parameter in req.body generated by the body-parser middleware.
 * _csrf parameter in req.query generated by query().
 * x-csrf-token and x-xsrf-token header fields.
 *
 * @param req
 * @param res
 * @param next
 */
exports.getCSRFToken = function(req, res, next)
{
    console.log("found route");
    console.log(req.accepts('application/json'));
    console.log(req.accepts('text/html'));
    if (req.accepts('application/json') != undefined && req.accepts('text/html') == false) {
        res.json({
            status: "success",
            csrfToken: res.locals._csrf
        });
    } else {
        next();
    }
}


exports.redirectIndex = function(req, res) {
    res.redirect("/");
};


/**
 * Allow for user authentication via a string-based token.
 */
exports.accessAuthenticate = function(req, res, next) {
    var app = req.application;

    if (! req.access_key || ! req.email){
        req.flash("Please use the login form to authenticate!");
        res.redirect("/login");
    } else {
        req.body.access = req.access_key;
        req.body.email = req.email;
        req.body.password = "yellowDemoMonkey";

        app.passport.authenticate('local', {
            successRedirect: '/dashboard',
            successFlash: 'Successfully logged in.',
            failureRedirect: '/login',
            failureFlash: "Authentication failed!"
        })(req, res, next);
    }
    return;
}

exports.basicLoginAuthentication = function(req, res, next) {
    var app = req.application;

    app.passport.authenticate('local', {
        successRedirect: '/dashboard',
        successFlash: 'Successfully logged in.',
        successMessage: '',
        failureRedirect: '/login',
        failureFlash: "Authentication failed!",
        failureMessage: "Wrong email or password"
    })(req, res, next);
    return;
}



exports.findAccessKey = function (req, res, next, key) {
    req.application.db.users.find({
        where: {access_key: key}})
        .success(function(item) {
            if (item) {
                req.data = item;
                req.email = item.email;
                req.access_key = item.access_key;
                next();
            } else {
                req.flash("error", "Please use the login form to authenticate!");
                res.redirect("/login");
            }
        })
        .error(function(error) {
            req.flash("error", "Please use the login form to authenticate!");
            res.redirect("/login");
        });
};


/**
 * Get /logout
 * @param req
 * @param res
 */
exports.getLogout = function(req, res)
{
    req.logout();
    req.flash("success", "You're signed out");
    res.redirect("/")
};


/**
 * GET /register
 * @param req
 * @param res
 */
exports.getRegister = function (req, res) {
    res.render("auth/register.j2", {})
};


/**
 * POST /register
 *
 * @param req
 * @param res
 */
exports.postRegister = function (req, res) {

    // force user role
    req.body.role = "user";
	
    req.application.db.users.createUser(
        req.body,
        function(result) {
            if (result.status == "success") {
                var user = result.data;

                req.flash("success", "You've signed up.");
                req.login(user, function(err, user) {
                    if (err) return next(err);
                    res.redirect("/registered");

                });

            } else {
                res.redirect("/register", null, result);
            }
        }
    )
};

/**
 * GET /registered
 * @param req
 * @param res
 */
exports.getRegistered = function(req, res) {
    res.render("auth/registered.j2");
};


/**
 * GET /change-password
 */
exports.getChangePassword = function(req, res) {
    res.render("auth/new-password.j2", {})
};


/**
 * POST /change-password
 */
exports.postChangePassword = function(req, res) {

    var app = req.application,
        params = req.body,
        user = req.user;

    if (!user.allow_access_key) {
        app.expressValidator.validator.extend('passwordMatch', function (str) {
            return app.db.users.checkPassword(user, str)
        });

        req.assert("oldPassword", "Make sure your old password is right").passwordMatch();
        req.assert("oldPassword", "Enter your old password").notEmpty();
    }

    req.assert("password", "Come up with a new password").notEmpty();
    req.assert("confirmPassword", "Confirm your new password").notEmpty();
    req.assert("confirmPassword", "Your new passwords don't match").equals(params.password);


    var errors = req.validationErrors(true);

    if (errors) {
        return res.render("auth/new-password.j2", { errors: errors }, {
            status: 'error',
            flash: 'Form errors!'});
    }

    if (!errors) {

        var updateObj = {
            allow_access_key: 0,
            password: params.password,
            confirmPassword: params.confirmPassword
        };

        app.db.users.updateUser(
            user.id,
            updateObj,
            function(result) {
                if (result.status == "success") {
                    req.flash("success", "Password changed successfully!");
                    res.redirect("/dashboard");
                } else {
                    res.redirect("back", null, result);
                }
            }
        )
    }
};


/**
 * GET /forgot-password
 * @param req
 * @param res
 */
exports.getForgotPassword = function(req, res) {
    res.render("auth/forgot-password.j2", {})
};


/**
 * POST /forgot-password
 */
exports.postForgotPassword = function(req, res, next) {
    req.assert('email', 'Please enter a valid email address.').isEmail();

    var redirectUrl = "/forgot-password";
    var errors = req.validationErrors(true);
    var User = req.application.db.users;
    var email = req.body.email.toLowerCase();
    var app = req.application;

    if (errors) {
        return res.render("auth/forgot-password.j2", { errors: errors }, {
        	status: 'error'
        });
    }

    async.waterfall([
        function(done) {
            crypto.randomBytes(16, function(err, buf) {
                var token = buf.toString('hex');
                done(err, token);
            });
        },
        function(token, done) {
            User.find({ where: {
                    email: email
                }})
                .error(next)
                .success(function(user) {

                    if (!user) {
                        req.errors('There\'s no user with that email address.');
                        return res.render("auth/forgot-password.j2", null, {
				        	status: 'error'
				        });
                    }

                    user.resetPasswordToken = token;
                    user.resetPasswordExpires = Date.now() + 3600000; // 1 hour

                    user.save()
                        .error(done)
                        .success(function(user) {
                            done(null, token, user);
                        });
                });
        },
        function(token, user, done) {
            var appName = req.application.config.app.name;
            var appEmail = req.application.config.app.from;
            var config = req.application.config.mail;

            var mailOptions = {
                to: user.email,
                from: "" + appName + " <" + appEmail + ">",
                subject: 'Reset your password on Democratic',
                text: nunjucks.render('auth/emails/reset-password.j2', {
                    host: req.headers.host, token: token
                })
            };
            app.mail.sendMail(mailOptions, function(err) {
                if (err) {
                    console.log(err);
                }
                done(err, user);
            });
        }
    ], function(err, user) {
        if (err) return next(err);

        req.session.resetUser = user;

        res.redirect("/forgot-password-sent");
    });
};


/**
 * GET /forgot-password-sent
 *
 * Valid as a one-shot confirmation that the forgot password email worked.
 *
 */
exports.getPasswordEmailSent = function(req, res) {
    var user = req.session.resetUser;

    if (user) {
        req.session.resetUser = null;
        res.render("auth/sent-email.j2", { email: user.email });
    } else {
        res.redirect("/login")
    }
};



/**
 * GET /reset/:token
 */
exports.getResetPassword = function(req, res, next) {
    var User = req.application.db.users;

    if (req.isAuthenticated()) {
        return res.redirect('/');
    }

    User
        .find({ where: {
            resetPasswordToken: req.params.token,
            resetPasswordExpires : { gt: Date.now() }
        }})
        .error(next)
        .success(function(user) {
            if (!user) {
                req.errors('Password reset token is invalid or has expired.');
                return res.redirect('/forgot-password');
            }
            res.render('auth/new-password.j2');
        });
};


/**
 * POST /reset/:token
 */
exports.postResetPassword = function(req, res, next) {
    var User = req.application.db.users;
    var params = req.body;
    var app = req.application;

    async.waterfall([
        function(done) {
            User
                .find({
                    where: {
                        resetPasswordToken: req.params.token,
                        resetPasswordExpires: { gt: Date.now() }
                    },
                    include: [ { model: app.db.userRole, include: [app.db.roles] } ]
                })
                .error(next)
                .success(function(user) {

                    if (!user) {
                        return res.redirect('auth/new-password.j2', null, {
                        	status: 'error',
                        	flash: 'Password reset token is invalid or has expired.'
                        });
                    }

                    var updateObj = {
                        password: params.password,
                        confirmPassword: params.confirmPassword,
                        resetPasswordToken: "",
                        resetPasswordExpires: Date.now(),
                        role: user.role
                    };

                    if (! app.db.users.checkPasswordEquality(updateObj.password, updateObj.confirmPassword)) {
                        req.flash("errors", "Your new passwords do not match");
                        return res.redirect("back");
                    }

                    user
                        .updateAttributes(updateObj)
                        .error(done)
                        .success(function(user) {
                            if (user) {
                                req.login(user, function(err) {
                                    done(err, user)
                                });
                            } else {
                                req.flash("errors", "There was an error saving your password. You'll need to request a new link.");
                                return res.redirect("/login");
                            }
                        });
                });
        }
    ], function(err, user) {
        if (err) return next(err);
        req.session.passwordResetSuccess = true;
        res.redirect('/change-password-success');

        var appName = req.application.config.app.name;
        var appEmail = req.application.config.app.from;

        var mailOptions = {
            to: user.email,
            from: "" + appName + " <" + appEmail + ">",
            subject: 'Your password has been changed',
            text:  nunjucks.render('auth/emails/reset-confirmed.j2', {
                email: user.email,
                host: req.headers.host
            })
        };
        app.mail.sendMail(mailOptions, function(err) {
            console.log("Email sent!");
        });


    });
};


/**
 * GET /change-password-success
 *
 * @param req
 * @param res
 * @returns {*}
 */
exports.getPasswordResetSuccess = function(req, res) {

    if (req.session.passwordResetSuccess) {
        req.session.passwordResetSuccess = false;
        return res.render("auth/change-password.j2");
    }

    return res.redirect("/dashboard");
};


/**
 * GET /delete-account
 */
exports.getDeleteAccount = function(req, res) {
    res.render("auth/delete.j2", {
        deletePhrase: req.user.deleteAccountPhrase
    });
};


/**
 * POST /delete-account
 *
 * It's a strange case in terms of validation, since we can't 
 * assert values on pseudo columns in Sequelize, we just drop
 * back to express-validate to take care of the phrase checking.
 */
exports.postDeleteAccount = function(req, res) {
    var password = req.body.password;
    var phrase = req.body.phrase;
    var db = req.application.db;

    req.assert('password', 'Enter your password')
        .notEmpty();

    req.assert('phrase', 'Type in the phrase exactly as it appears')
        .equals(req.user.deleteAccountPhrase);

    var errors = req.validationErrors();

    if (errors) {

        res.redirect("back", null , {errors: errors});
    }

    if (db.users.checkPassword(req.user, password)) {
        req.user.destroy().success(function() {
            req.logout();
            console.log("removed account!");
            res.redirect("/deleted-account");
        })
    } else {
        req.flash("errors", { password: { msg: "Oops, wrong password" }});
        res.redirect("back");
    }
};


/**
 * GET /delete-account-success
 */
exports.getDeleteAccountSuccess = function(req, res) {
    res.render("auth/deleted.j2");
};

