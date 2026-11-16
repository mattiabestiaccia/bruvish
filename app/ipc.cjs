function authorizeUi(event, trustedContents, uiUrl) {
  if (!trustedContents || event.sender !== trustedContents || event.senderFrame !== trustedContents.mainFrame ||
      event.senderFrame?.url !== uiUrl || trustedContents.getURL() !== uiUrl) throw Error('Untrusted application frame');
}
module.exports = {authorizeUi};
