function calculateSalary(baseSalary, overTimeHours, underTimeHours, joiningDate, checkInTime, checkOutTime, pfGiven) {
    const WORKING_HOURS = 9;
    const PF_RATE = 0.12;
    const currentDate = new Date();
    const presentYear = currentDate.getFullYear();
    const month = currentDate.getMonth() + 1;

    console.log("Current Date: ", currentDate);
    console.log("Present Month: ", month);
    console.log("Present Year: ", presentYear);

    let days;
    if ((presentYear % 4 === 0 && presentYear % 100 !== 0) || (presentYear % 400 === 0)) {
        if (month === 2) {
            days = 29;  // Adjusted for leap year
        } else if ([4, 6, 9, 11].includes(month)) {
            days = 30;
        } else {
            days = 31;
        }
    } else {
        if (month === 2) {
            days = 28;
        } else if ([4, 6, 9, 11].includes(month)) {
            days = 30;
        } else {
            days = 31;
        }
    }

    console.log("Days: ", days);

    // Parsing dates and times
    const joiningDateObj = new Date(joiningDate);
    const checkInTimeObj = new Date(`1970-01-01T${checkInTime}Z`);
    const checkOutTimeObj = new Date(`1970-01-01T${checkOutTime}Z`);
    const payoutDate = new Date(joiningDateObj.getTime() + days * 24 * 60 * 60 * 1000);

    // Calculate the number of days between joining date and payout date
    const daysWorked = Math.floor((payoutDate - joiningDateObj) / (1000 * 60 * 60 * 24));

    // Calculate hourly salary
    const hourlySalary = baseSalary / (30 * WORKING_HOURS);

    // Calculate OverTime and UnderTime salary
    const dailyHoursWorked = (checkOutTimeObj - checkInTimeObj) / (1000 * 60 * 60);
    let overTimeSalary = 0;
    let underTimeSalary = 0;

    if (dailyHoursWorked > WORKING_HOURS) {
        overTimeSalary = (dailyHoursWorked - WORKING_HOURS) * hourlySalary;
    } else if (dailyHoursWorked < WORKING_HOURS) {
        underTimeSalary = (WORKING_HOURS - dailyHoursWorked) * hourlySalary;
    }

    // Calculate gross salary
    const grossSalary = (baseSalary / 30) * daysWorked + (overTimeHours * hourlySalary) - (underTimeHours * hourlySalary);

    let netSalary;
    let pfDeduction = 0;
    if (pfGiven) {
        // Deduct 12% PF from gross salary
        pfDeduction = grossSalary * PF_RATE;
        netSalary = grossSalary - pfDeduction;
    } else {
        // No PF; only deduct overtime and undertime
        netSalary = grossSalary;
    }

    // Add OverTime salary and subtract UnderTime salary
    netSalary += overTimeSalary - underTimeSalary;

    return {
        "Payout Date": payoutDate.toISOString().split('T')[0],
        "Base Salary": baseSalary,
        "Days Worked": daysWorked,
        "Per Hour Salary": Math.round(hourlySalary * 100) / 100,
        "OverTime Salary": Math.round(overTimeSalary * 100) / 100,
        "UnderTime Salary": Math.round(underTimeSalary * 100) / 100,
        "Gross Salary": Math.round(grossSalary * 100) / 100,
        "PF Deduction": Math.round(pfDeduction * 100) / 100,
        "Net Salary": Math.round(netSalary * 100) / 100,
    };
}

// Example usage:
const baseSalary = 30000;  // Monthly base salary
const overTimeHours = 0;  // Total overtime hours worked
const underTimeHours = 0;  // Total undertime hours
const joiningDate = "2023-01-01";  // Joining date in YYYY-MM-DD format
const checkInTime = "09:00:00";  // Daily check-in time in HH:MM:SS format
const checkOutTime = "19:00:00";  // Daily check-out time in HH:MM:SS format
const pfGiven = true;  // True if PF is given, False otherwise

const salaryDetails = calculateSalary(baseSalary, overTimeHours, underTimeHours, joiningDate, checkInTime, checkOutTime, pfGiven);
for (const [key, value] of Object.entries(salaryDetails)) {
    console.log(`${key}: ${value}`);
}
