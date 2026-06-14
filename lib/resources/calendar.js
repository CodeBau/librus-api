"use strict";
const _ = require("lodash");
const FormData = require('form-data');
const Resource = require("../tools.js").Resource,
  Librus = require("../api");

module.exports = class Calendar extends Resource {
  /**
   * Get event description
   * https://synergia.librus.pl/terminarz/szczegoly
   *
   * @param id  Event ID
   * @param isAbsence Make it 'true' if the event is teacher's absence
   * @returns {Promise}
   */
  getEvent(id, isAbsence = false) {
    if (isAbsence) {
      return this.api._tableMapper(
        `terminarz/szczegoly_wolne/${id}`,
        "table.decorated.small.center tbody",
        ["teacher", "range", "added"]
      );
    } else {
      return this.api._tableMapper(
        `terminarz/szczegoly/${id}`,
        "table.decorated.medium.center tbody",
        {'Data': 'date', 'Nr lekcji': 'lesson', 'Nauczyciel': 'teacher', 'Rodzaj': 'type', 'Przedmiot': 'lesson', 'Sala': 'room', 'Opis': 'description', 'Data dodania': 'added', 'Przedział czasu': 'timespan'}
      );
    }
  }

  /**
   * Get all calendar data
   * https://synergia.librus.pl/terminarz
   *
   * @returns {Promise}
   * @param month Choose calendar month (1-12)
   * @param year Choose year
   */
  static get API_REVISION() { return "2026.06.14.calendar_fix"; }

  getCalendar(month, year) {
    const now = new Date();
    const targetMonth = month ? Number(month) : now.getMonth() + 1;
    const targetYear = year ? Number(year) : now.getFullYear();

    let parser = ($, column) => {
      let dayNum = $(column).find(".kalendarz-numer-dnia").text().trim();
      let details = $(column).find("td");
      if (details.length > 0) {
        return _.map($(details), (child) => {
          let onclick = $(child).attr("onclick");
          const isoMonth = String(targetMonth).padStart(2, '0');
          const isoDay = String(dayNum).padStart(2, '0');
          return {
            id: parseInt(onclick && onclick.match(/\/(\d*)'$/)[1]) || -1,
            day: `${targetYear}-${isoMonth}-${isoDay}`,
            title: $(child).trim(),
          };
        });
      }
    };

    return this.api._mapper(
      `terminarz/index/miesiac/${targetMonth}/rok/${targetYear}`,
      "table.kalendarz.decorated.center tbody td .kalendarz-dzien",
      parser
    );
  }

  /**
   * Get school timetable
   * https://synergia.librus.pl/przegladaj_plan_lekcji
   *
   * @param from  From date e.g. 2015-12-14
   * @param to    To date e.g. 2015-12-21
   * @returns {Promise}
   */
  getTimetable(from, to) {
    const days = [
      "Monday",
      "Tuesday", 
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
      "Sunday",
    ];

    // If no dates provided, use current week
    if (!from || !to) {
      const today = new Date();
      const monday = new Date(today);
      monday.setDate(today.getDate() - today.getDay() + 1);
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      
      from = monday.toISOString().split('T')[0];
      to = sunday.toISOString().split('T')[0];
    }

    /** Parser */
    let parser = ($, row) => {
      // Skip break rows (line0 class)
      if ($(row).hasClass("line0")) {
        return null;
      }

      // Get the hour from the th element
      let hour = $(row).find("th").text().trim();
      
      // Get all lesson cells (skip first td with lesson number and last td with lesson number)
      let lessonCells = $(row).find("td").slice(1, -1);
      
      let list = [];
      lessonCells.each((index, cell) => {
        let $cell = $(cell);
        let textDiv = $cell.find(".text");
        
        if (textDiv.length > 0 && textDiv.text().trim()) {
          // Extract subject name (bold text)
          let subject = textDiv.find("b").text().trim();
          
          // Extract teacher and room info (text after <br>)
          let teacherRoom = textDiv.html();
          if (teacherRoom) {
            // Split by <br> and get the second part
            let parts = teacherRoom.split("<br>");
            if (parts.length > 1) {
              let teacherRoomText = parts[1].replace(/<[^>]*>/g, "").trim();
              // Decode HTML entities
              teacherRoomText = teacherRoomText.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
              
              // Remove leading dash if present
              if (teacherRoomText.startsWith("-")) {
                teacherRoomText = teacherRoomText.substring(1).trim();
              }
              
              // Split teacher and room - look for "s." pattern
              let match = teacherRoomText.match(/^(.+?)\s+s\.\s+(.+)$/);
              let teacher = match ? match[1].trim() : teacherRoomText;
              let room = match ? match[2].trim() : "";
              
              list.push({
                subject: subject,
                teacher: teacher,
                room: room,
                time: hour
              });
            } else {
              list.push({
                subject: subject,
                teacher: "",
                room: "",
                time: hour
              });
            }
          }
        } else {
          // Empty cell
          list.push(null);
        }
      });

      return {
        hour: hour,
        list: list,
      };
    };

    /**
     * Map columns in first array to others
     * @param $   Document
     * @returns {Array}
     */
    let tableMapper = ($) => {
      /** Map rows to days */
      let table = {};
      let hours = [];
      
      // Find all lesson rows (class="line1")
      let rows = $("table.decorated.plan-lekcji tbody tr.line1");
      
      if (rows.length === 0) {
        // Try alternative selectors
        rows = $("tr.line1");
      }
      
      rows.each((index, row) => {
        let parsed = parser($, row);
        if (parsed && parsed.hour) {
          hours.push(parsed.hour);
          
          // Map each lesson to the corresponding day
          parsed.list.forEach((lesson, dayIndex) => {
            if (dayIndex < days.length) {
              let dayKey = days[dayIndex];
              if (!table[dayKey]) {
                table[dayKey] = [];
              }
              table[dayKey].push(lesson);
            }
          });
        }
      });

      return {
        hours: hours,
        table: table,
      };
    };

    /** API call */
    let formData = new FormData()
    formData.append("tydzien", `${from}_${to}`)
    return this.api._request("post", "przegladaj_plan_lekcji", formData)
    .then(tableMapper);
  }
};
