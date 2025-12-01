from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("app_workout", "0026_cardiodailylog_ignore_strengthdailylog_ignore_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="cardiodailylog",
            name="three_mile_time",
            field=models.FloatField(blank=True, null=True),
        ),
    ]

