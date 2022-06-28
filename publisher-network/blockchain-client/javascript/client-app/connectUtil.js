const { Gateway, Wallets } = require('fabric-network');
const FabricCAServices = require('fabric-ca-client');
const path = require('path');
const { buildCAClient, registerAndEnrollUser, enrollAdmin } = require('../../../admin-user-creator/CAUtil.js');
const { buildCCPOrg1, buildWallet } = require('../../../admin-user-creator/AppUtil.js');

const walletPath = path.join(__dirname, '..', 'wallet');

exports.connect = async ({caClientPath, mspOrg, orgUserId, userPath}) => {

  try {
    // setup the wallet to hold the credentials of the application user
    let wallet = await buildWallet(Wallets, walletPath);

    // build an in memory object with the network configuration (also known as a connection profile)
    let ccp = buildCCPOrg1();

    // build an instance of the fabric ca services client based on
    // the information in the network configuration
    let caClient = buildCAClient(FabricCAServices, ccp, caClientPath);

    // in a real application this would be done on an administrative flow, and only once
    await enrollAdmin(caClient, wallet, mspOrg);

    // in a real application this would be done only when a new user was required to be added
    // and would be part of an administrative flow
    await registerAndEnrollUser(caClient, wallet, mspOrg, orgUserId, userPath);

    let gateway = new Gateway();

    // setup the gateway instance
    // The user will now be able to create connections to the fabric network and be able to
    // submit transactions and query. All transactions submitted by this gateway will be
    // signed by this user using the credentials stored in the wallet.
    await gateway.connect(ccp, {
      wallet,
      identity: orgUserId,
      discovery: { enabled: true, asLocalhost: true } // using asLocalhost as this gateway is using a fabric network deployed locally
    });

    return gateway;
  }
  catch (error) {
    console.log(error);
  }
}