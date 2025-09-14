from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("app_workout", "0012_vwmphgoal"),
    ]

    operations = [
        migrations.AddField(
            model_name="cardiodailylog",
            name="mph_goal",
            field=models.FloatField(null=True, blank=True),
        ),
        migrations.AddField(
            model_name="cardiodailylog",
            name="mph_goal_avg",
            field=models.FloatField(null=True, blank=True),
        ),
    ]

