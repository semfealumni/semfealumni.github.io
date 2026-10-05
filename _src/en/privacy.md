---
path: privacy/
layout: text
title: Privacy policy
description: >-
  What data the website of the SEMFE Alumni Association collects when
  you create an account, why, where it is stored and how you delete it.
hero:
  eyebrow: Legal
  title: Privacy policy
  lede: What data we keep when you create an account, why, and how you delete it.
crumbs:
  - [Privacy policy, null]
---

<div class="notice"><p>This is an English translation provided for convenience. If it differs from the Greek text, the Greek text applies.</p></div>

Last updated: 1 October 2026
{ .muted }

## Who we are

The data controller is the **SEMFE Alumni Association**, the association of the graduates of the School of Applied Mathematical and Physical Sciences of NTUA (“the Association”). Contact: [gradsemfe@gmail.com](mailto:gradsemfe@gmail.com).

## Without an account

You can read the whole website without creating an account. We use no cookies and no advertising tools. We count how many people visit the website without storing anything that identifies you (see “Visit statistics” below). The website is hosted on GitHub Pages and loads fonts from Google Fonts; like any server, these services receive your IP address in order to send you the page. Embedded videos are loaded from YouTube in privacy-enhanced mode (youtube-nocookie.com).

The sign-in service (Google's Firebase, from gstatic.com) is loaded only when you need it: when you press “Sign in”, on the members' pages, or if you have signed in from this browser before. It then keeps in your browser (in IndexedDB and in localStorage) what it needs to keep you signed in. If you are only reading the website, the browser keeps just a marker that your visit has already been counted, in the tab's memory (sessionStorage), which is erased as soon as you close the tab. The What's new and Statistics pages ask Firebase what has been approved for publication and what the anonymous member statistics are; this happens without cookies and without anything being stored in your browser.

## Visit statistics

To know how many people read the website and from where, we use two counters. The results, only as totals, are published on the [Statistics]({{root}}analytics/) page.

- **Google Analytics 4, without cookies.** It stores nothing on your device (no cookie and nothing else), and we have switched off the advertising features and “Google signals”. It sends Google the page you read (without the parameters of its address), the type of your device and the page you came from. From your IP address Google works out the country and the city; according to Google, Google Analytics 4 does not log or store IP addresses. Because there is no identifier on your device, it cannot know whether you are the same visitor as yesterday.
- **Our own counter.** Each page sends our server a short message: which page you read, whether it is the first page of your visit, and which website you came from. On the first page of each visit, the server looks up which organisation owns the network you are connecting from (in the public address registries) and keeps **only the name** of the university or company, if the network belongs to such an organisation. **Your IP address is not stored or logged anywhere.** Home and mobile connections belong to internet providers and are not matched to anyone. We keep only totals per day (for example “12 visits to Announcements”, “2 visits from NTUA”), never a record per visitor. A company is shown publicly only if it has at least two visits in the period.

If your browser asks not to be tracked (Global Privacy Control or Do Not Track), we do not count your visit at all, with either of the two counters. The administration pages and the LinkedIn sign-in page are never counted.

## When you create an account

Signing in works through Google's **Firebase Authentication** service. You can sign in with {{signin}} and password. From the provider you choose we receive only:

- your **name**,
- your **e-mail** address,
- your **profile photo** (if there is one), and
- an identifier of your account with the provider.

<!--if:social-->We do not receive your {{signin-social}} password, nor any access to your contacts, posts or messages. <!--/if:social-->If you sign in with e-mail, your password is stored encrypted by Firebase and is not visible to anyone.

The website's administrators see a list of all accounts: the name, the e-mail, the ways of signing in, and when each one was created and last signed in. They use it to find duplicate accounts of the same person and merge them into one. Every such merge is recorded (which accounts, by whom, when).

## The membership application

If you fill in the membership application, we store the details you give (full name, e-mail, phone number if you give it, years of admission and graduation, study track, job, industry, city, country, gender if you give it, LinkedIn profile and your contact preferences) in Google's **Cloud Firestore** database. We use them to:

- confirm that you are a graduate or a final-year student of SEMFE NTUA,
- keep the register of members and the membership fees, as the Statute requires,
- send you news and job announcements, **only if you choose to**,
- produce the **anonymous** member statistics on the [Statistics]({{root}}analytics/#meli) page.

Industry, country and gender are optional. For the statistics we count only totals per question (e.g. “12 members in Athens”), never two answers of the same person together and never a name or an e-mail. A group of fewer than 3 people is not shown by name (it goes into “Other”), a question is shown only when at least 5 people have answered it, and years are counted in five-year periods. The answer “I prefer not to say” is not counted anywhere.

Your details are seen by you and by the members of the Board of Directors who manage the register of members. **We do not sell them and we do not give them to third parties.**

## The members' directory

If you choose to, a short profile of you (full name, year of graduation, study track, job, city, LinkedIn) appears in the directory of the **Members' area**, which only active members of the Association can see. You can withdraw it at any time from your account.

## E-mail alerts

If you choose [e-mail alerts]({{root}}account/#alerts) (announcements of the Association, events and meetings, website news), we keep which ones you chose and your account's e-mail address, so that we can send you a short e-mail when something new of these is published. The e-mails go only to your confirmed sign-in address. Every e-mail has a link that stops them all with one button, and you can change your choices whenever you like from your account. They are deleted together with your account.

## Feedback and problem reports

If you write to us from the [Feedback and problems]({{root}}feedback/) page, we keep your message, the screenshots you attached, the page it concerns, the type of your browser and your account details (name and sign-in e-mail), so that we can look into it and reply to you. We send you e-mails only at your account's address and only if it is confirmed: a confirmation with the number of your message and, later, our reply. The messages are seen by the website's administrators, and a copy of them is kept in a private repository on GitHub, where we read them in order to fix the problems. They are deleted together with your account.

## Where it is stored

In Google's Firebase services (Google Cloud). Google acts as a data processor, under the [Firebase data processing terms](https://firebase.google.com/terms/data-processing-terms){ newtab }.

## Legal basis and retention

We process your details on the basis of your **consent** and your **membership** (Article 6(1)(a) and (b) of the General Data Protection Regulation, GDPR). We keep them for as long as you have an account. When you delete your account, we delete them.

## Your rights

You have the right of access, rectification, erasure, restriction, portability and objection, as well as the right to withdraw your consent. You can exercise most of them yourself from the [My account]({{root}}account/) page. For anything else, write to us at [gradsemfe@gmail.com](mailto:gradsemfe@gmail.com). You also have the right to lodge a complaint with the [Hellenic Data Protection Authority](https://www.dpa.gr){ newtab }.

## Deleting your account

See the [data deletion instructions]({{root}}data-deletion/).
