let license_license;

async function license_check() {
    const banner = document.getElementById('license-banner');
    const res = await network_authLicense();
    license_license = await res.json();

    if (!license_license.valid) {
        if (banner.classList.contains('license-hidden')) {
            banner.classList.remove('license-hidden');
        }
        banner.innerHTML = `This instance of ExoServe is unlicensed. To purchase a license go to <a href="https://exoserve.ciphranova.com" target="_blank">exoserve.ciphranova.com</a>`;
    } else if (!license_license.supported) {
        if (banner.classList.contains('license-hidden')) {
            banner.classList.remove('license-hidden');
        }
        banner.innerHTML = `The license for this instance of ExoServe expired ${license_license.data.support_end_date}. To renew the license go to <a href="https://exoserve.ciphranova.com" target="_blank">exoserve.ciphranova.com</a>`;
    } else {
        if (!banner.classList.contains('license-hidden')) {
            banner.classList.add('license-hidden');
        }
    }
}
